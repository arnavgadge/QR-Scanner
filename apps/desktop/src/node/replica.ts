/**
 * The backup main computer's copy of the data (backup side). Connects to the main computer's
 * /replicate channel over the station's pinned TLS connection, applies the full copy and then
 * every change in order (each batch in one transaction), and confirms what it has. The copy is a
 * normal database file in this computer's server folder, ready to be used if an administrator
 * makes this computer the main computer.
 */
import WebSocket from 'ws';
import { describeError, logger } from '../log';
import type { ReplEntry, SqliteStore } from '../server/store';
import type { ServerLink } from './link';

const log = logger('backup');

export interface ReplicaStatus {
  /** Receiving changes right now. */
  connected: boolean;
  /** Last time this copy had every change of the main computer (ISO), else null. */
  lastCopiedAt: string | null;
  /** Highest change applied. */
  seq: number;
  /** While the first full copy arrives: how much of it is here (0–100), else null. */
  copyProgress: number | null;
  /** This copy was complete at least once (false = most data may be missing). */
  everComplete: boolean;
}

export class Replica {
  private ws: WebSocket | null = null;
  /** Which main computer (address and term) the copy channel is connected to. */
  private target = '';
  private readonly watch: NodeJS.Timeout;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private source = '';
  /** The full copy being received: rows expected and rows applied so far. */
  private snapshot: { seq: number; total: number; received: number } | null = null;
  private _connected = false;
  /** Highest change the main computer has told us about. */
  private head = 0;

  constructor(
    private readonly opts: {
      store: SqliteStore;
      link: ServerLink;
      now?: () => Date;
      retryMs?: number;
      /** Tests: a slow network to the backup (each message applied this much later). */
      delayMs?: number;
      onStatus?: (status: ReplicaStatus) => void;
    },
  ) {
    this.connect();
    // The copy channel follows the station's link: if the link moved to another main computer
    // (or learned of a newer term), this channel is closed at once, so a former main computer can
    // never keep counting this computer as its backup.
    this.watch = setInterval(() => {
      // (A link that is only briefly offline is not a change: the copy carries on.)
      const now = this.targetOf();
      if (this.ws && now && now !== this.target) {
        log.info('the main computer changed: reconnecting the copy channel');
        this.ws.terminate();
      }
    }, 250);
    this.watch.unref?.();
  }

  private targetOf() {
    const c = this.opts.link.connection();
    return c ? `${c.endpoint.host}:${c.endpoint.port}|${this.opts.link.term}` : '';
  }

  status(): ReplicaStatus {
    return {
      connected: this._connected,
      lastCopiedAt: this.opts.store.getLocalSync('repl_synced_at') || null,
      seq: Number(this.opts.store.getLocalSync('repl_seq')) || 0,
      copyProgress: this.snapshot
        ? Math.min(
            99,
            Math.floor((this.snapshot.received / Math.max(1, this.snapshot.total)) * 100),
          )
        : null,
      everComplete: this.opts.store.replEverComplete(),
    };
  }

  /** Every change the main computer has is applied here. */
  caughtUp(): boolean {
    return this._connected && this.status().seq >= this.head && this.head > 0;
  }

  /** Waits until this copy has change `seq` (planned switch); false after `ms`. */
  async waitFor(seq: number, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.status().seq >= seq) return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.status().seq >= seq;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watch);
    if (this.timer) clearTimeout(this.timer);
    this.ws?.terminate();
    this.ws = null;
    this.setConnected(false);
  }

  private connect() {
    if (this.stopped || this.ws) return;
    const c = this.opts.link.connection();
    if (!c) return this.later();
    const { store } = this.opts;
    this.target = this.targetOf();
    const ws = new WebSocket(`wss://${c.endpoint.host}:${c.endpoint.port}/replicate`, {
      ...c.tls,
      headers: {
        ...c.headers,
        'x-repl-source': store.getLocalSync('repl_source') ?? '',
        'x-repl-seq': store.getLocalSync('repl_seq') ?? '0',
      },
      handshakeTimeout: 5_000,
      maxPayload: 256 * 1024 * 1024,
    });
    this.ws = ws;
    ws.on('open', () => this.setConnected(true));
    let queue = Promise.resolve();
    ws.on('message', (data) => {
      const apply = () => {
        if (this.ws !== ws) return;
        try {
          this.onMessage(ws, JSON.parse(String(data)) as Record<string, unknown>);
        } catch (e) {
          log.error(`could not apply a change from the main computer: ${describeError(e)}`);
          ws.terminate(); // reconnects and continues from what is applied
        }
      };
      const delay = this.opts.delayMs;
      if (!delay) return apply();
      queue = queue.then(() => new Promise<void>((r) => setTimeout(() => (apply(), r()), delay)));
    });
    ws.on('unexpected-response', (_req, res) => {
      log.warn(
        `copy channel refused: HTTP ${res.statusCode} ${String(res.headers['x-error-code'] ?? '')}`,
      );
      ws.terminate();
    });
    ws.on('error', (e) => log.warn(`copy channel: ${describeError(e)}`));
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      // An unfinished full copy stays as it is (marked incomplete); the next one starts over.
      this.snapshot = null;
      this.setConnected(false);
      this.later();
    });
  }

  private later() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.opts.retryMs ?? 2_000);
    this.timer.unref?.();
  }

  private onMessage(ws: WebSocket, m: Record<string, unknown>) {
    const { store } = this.opts;
    const ack = (seq: number) => {
      if (seq >= this.head) {
        store.setLocalSync('repl_synced_at', (this.opts.now?.() ?? new Date()).toISOString());
      }
      ws.send(JSON.stringify({ t: 'ack', seq }));
      this.emit();
    };
    switch (m.t) {
      case 'hello':
        this.source = String(m.source ?? '');
        return;
      case 'snap-begin':
        // Only ever from the main computer this station's link verified (see connect()).
        this.snapshot = { seq: Number(m.seq) || 0, total: Number(m.total) || 0, received: 0 };
        this.head = Math.max(this.head, this.snapshot.seq);
        store.replBeginSnapshot();
        log.info(`receiving a full copy from the main computer (${this.snapshot.total} rows)`);
        this.emit();
        return;
      case 'snap-rows': {
        if (!this.snapshot) return;
        const rows = (m.rows as Record<string, unknown>[]) ?? [];
        store.replApplyRows(String(m.tbl), rows);
        this.snapshot.received += rows.length;
        ws.send(JSON.stringify({ t: 'progress', received: this.snapshot.received }));
        this.emit();
        return;
      }
      case 'snap-end': {
        const snap = this.snapshot;
        this.snapshot = null;
        if (!snap) return;
        store.replFinishSnapshot(snap.seq, this.source);
        log.info(`full copy complete (up to change ${snap.seq})`);
        return ack(snap.seq);
      }
      case 'changes': {
        this.head = Math.max(this.head, Number(m.head) || 0);
        const seq = store.replApply((m.entries as ReplEntry[]) ?? []);
        store.setLocalSync('repl_source', this.source);
        return ack(seq);
      }
    }
  }

  private setConnected(v: boolean) {
    if (this._connected === v) return;
    this._connected = v;
    log.info(
      v ? "receiving the main computer's data" : 'not receiving data from the main computer',
    );
    this.emit();
  }

  private emit() {
    this.opts.onStatus?.(this.status());
  }
}
