/**
 * Backup main computer, terms and the network-split rule (main computer side).
 *
 * BACKUP: an administrator marks exactly one station as the backup. It connects to /replicate and
 * receives every change (store.ts records each one in repl_log inside the writing transaction):
 * first a full copy, then each change as it happens, and confirms what it has applied. Before a
 * registration answers "new", the main computer waits up to 2 s for that confirmation when the
 * backup is connected.
 *
 * TERMS: every promotion raises the term. Stations send the highest term they know with every
 * request; a main computer that hears of a higher term retires: it never registers again.
 *
 * NETWORK-SPLIT RULE (registration is allowed only when one of these holds):
 *   1. no backup is set (nothing could have been promoted), or
 *   2. the backup is connected, or
 *   3. more than half of the OTHER stations are connected (every paired, not removed computer
 *      except this one and the backup; if there are none, rule 3 never holds, so the backup is
 *      required).
 * "Connected" means a live connection that has been up for at least LEASE and answered within the
 * last LEASE. A computer only keeps a live connection to the main computer of the highest term it
 * knows, so it can never count for two main computers at once: the old one stops counting it at
 * most LEASE after its last answer, the new one starts counting it at least LEASE after it
 * connected. For the same reason a main computer waits LEASE after starting or being promoted
 * before rule 2 or 3 can apply. Two main computers can therefore never both register.
 */
import { performance } from 'node:perf_hooks';
import { X509Certificate } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ClusterInfo, ClusterStatus, ServerEvent } from '../../../web/src/desktop/protocol';
import { logger } from '../log';
import { isUsableAnchor } from './certificate';
import type { ReplEntry, SqliteStore } from './store';

const log = logger('cluster');

export const ACK_WAIT_MS = 2_000;
export const DEFAULT_HEARTBEAT_MS = 5_000;
/** 3 heartbeats. */
export const DEFAULT_LEASE_MS = 15_000;
const SNAPSHOT_BATCH = 2_000;
const CHANGES_BATCH = 1_000;

interface Conn {
  ws: WebSocket;
  connectedAt: number;
  lastSeen: number;
}

interface BackupConn extends Conn {
  nodeId: string;
  sentSeq: number;
  ackedSeq: number;
  /** Set while the full copy is being sent. */
  snapshotting: boolean;
  /** The full copy until the backup confirms all of it: rows in it, rows the backup applied. */
  copy: { seq: number; total: number; received: number; reportedAt: number } | null;
}

export interface ClusterOptions {
  store: SqliteStore;
  certPem: string;
  /** Timestamps for records (ISO). */
  now: () => Date;
  broadcast: (event: ServerEvent) => void;
  onRetired?: () => void;
  heartbeatMs?: number;
  leaseMs?: number;
  ackWaitMs?: number;
}

export class Cluster {
  private readonly store: SqliteStore;
  private readonly lease: number;
  private readonly ackWait: number;
  private readonly startedAt = performance.now();
  private readonly stations = new Map<string, Set<Conn>>();
  private backup: BackupConn | null = null;
  private readonly waiters = new Set<{ seq: number; done: () => void }>();
  private readonly fingerprint: string;
  private closed = false;
  /** Main computers of other systems seen on this network (warned about on the admin pages). */
  private otherSystems: { serverId: string; name: string }[] = [];

  constructor(private readonly opts: ClusterOptions) {
    this.store = opts.store;
    this.lease = opts.leaseMs ?? DEFAULT_LEASE_MS;
    this.ackWait = opts.ackWaitMs ?? ACK_WAIT_MS;
    this.fingerprint = new X509Certificate(opts.certPem).fingerprint256;
    if (!this.store.getLocalSync('role')) this.store.setLocalSync('role', 'main');
  }

  // ---------------- identity ----------------

  get role(): 'main' | 'retired' {
    return this.store.getLocalSync('role') === 'retired' ? 'retired' : 'main';
  }

  term(): number {
    return Math.max(1, Number(this.metaSync('term')) || 1);
  }

  /** Which history of changes the backup is following (changes on promotion or a new certificate). */
  private sourceId() {
    return `${this.metaSync('server_id') ?? ''}:${this.fingerprint}:${this.term()}`;
  }

  private metaSync(key: string): string | null {
    const r = this.store.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return r?.value ?? null;
  }
  private setMetaSync(key: string, value: string) {
    this.store.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  /** Something about the backup changed. */
  private bump() {
    this.setMetaSync('cluster_rev', String((Number(this.metaSync('cluster_rev')) || 0) + 1));
  }

  backupNodeId(): string | null {
    return this.metaSync('backup_node_id') || null;
  }

  info(): ClusterInfo {
    const backupId = this.backupNodeId();
    return {
      clusterId: this.metaSync('server_id') ?? '',
      term: this.term(),
      revision: Number(this.metaSync('cluster_rev')) || 0,
      role: this.role,
      certPem: this.opts.certPem,
      backup: backupId ? { nodeId: backupId, certPem: this.metaSync('backup_cert') || null } : null,
    };
  }

  // ---------------- terms ----------------

  /** A computer told us the highest term it knows: a higher one means we were replaced. */
  seenTerm(term: number) {
    if (!Number.isSafeInteger(term) || term <= this.term() || this.role === 'retired') return;
    this.retire(term, 'a station knows a newer main computer');
  }

  /** Stops registering for good (a backup was made the main computer). */
  retire(newTerm: number, why: string) {
    if (this.role === 'retired') return;
    log.warn(`this computer is no longer the main computer (term ${newTerm}): ${why}`);
    this.store.setLocalSync('role', 'retired');
    this.store.setLocalSync('superseded_term', String(newTerm));
    this.opts.broadcast({ type: 'cluster-changed' });
    this.opts.onRetired?.();
    // Stations move on to the new main computer.
    for (const set of this.stations.values()) for (const c of set) c.ws.close(4003, 'retired');
  }

  /** Planned switch: the backup asks us to step down; it gets every change first. */
  stepDown(nodeId: string, term: number): { finalSeq: number } {
    if (nodeId !== this.backupNodeId()) throw new Error('not the backup');
    if (term <= this.term()) throw new Error('term not higher');
    this.retire(term, 'stepped down for the backup (planned switch)');
    this.kick();
    return { finalSeq: this.store.replLastSeq() };
  }

  // ---------------- choosing the backup ----------------

  async setBackup(nodeId: string): Promise<boolean> {
    const node = (await this.store.listNodes()).find((n) => n.id === nodeId);
    if (!node || node.isServer) return false;
    if (this.backupNodeId() !== nodeId) {
      this.setMetaSync('backup_node_id', nodeId);
      this.setMetaSync('backup_cert', '');
      this.store.setLocalSync('backup_copied_at', '');
      // The previous backup is disconnected; it erases its copy when it hears it is not the backup.
      this.backup?.ws.close(4002, 'not-backup');
      this.backup = null;
      this.bump();
    }
    this.setMetaSync('needs_backup', '0');
    log.info(`backup main computer is now station ${nodeId.slice(0, 8)} (${node.name})`);
    this.opts.broadcast({ type: 'cluster-changed' });
    return true;
  }

  /**
   * A station was removed. If it was the backup: no backup any more (nothing is copied until an
   * administrator chooses a new one, and they are asked to). The removed station erases its copy
   * when it hears it was removed.
   */
  stationRemoved(nodeId: string) {
    if (nodeId !== this.backupNodeId()) return;
    log.warn(
      `the backup ${nodeId.slice(0, 8)} was removed: no data is copied until a new backup is chosen`,
    );
    this.setMetaSync('backup_node_id', '');
    this.setMetaSync('backup_cert', '');
    this.setMetaSync('needs_backup', '1');
    this.store.setLocalSync('backup_copied_at', '');
    this.backup?.ws.close(4001, 'revoked');
    this.backup = null;
    this.bump();
    this.opts.broadcast({ type: 'cluster-changed' });
  }

  /** The backup's TLS certificate, shared with every station so they can switch to it. */
  registerBackupCert(nodeId: string, certPem: string): boolean {
    if (nodeId !== this.backupNodeId() || !isUsableAnchor(certPem)) return false;
    if (this.metaSync('backup_cert') !== certPem) {
      this.setMetaSync('backup_cert', certPem);
      this.bump();
      this.opts.broadcast({ type: 'cluster-changed' });
    }
    return true;
  }

  /** What this computer's app currently sees on the network (see runtime.ts). */
  setOtherSystems(list: { serverId: string; name: string }[]) {
    const sorted = [...list].sort((a, b) => a.serverId.localeCompare(b.serverId));
    if (JSON.stringify(sorted) === JSON.stringify(this.otherSystems)) return;
    this.otherSystems = sorted;
    this.opts.broadcast({ type: 'cluster-changed' });
  }

  // ---------------- liveness ----------------

  stationConnected(nodeId: string, ws: WebSocket) {
    const now = performance.now();
    const conn: Conn = { ws, connectedAt: now, lastSeen: now };
    const set = this.stations.get(nodeId) ?? new Set();
    set.add(conn);
    this.stations.set(nodeId, set);
    ws.on('pong', () => (conn.lastSeen = performance.now()));
    ws.on('close', () => set.delete(conn));
  }

  /** Counts for the network-split rule (see the top of this file). */
  /** Live and answering (it may not have lasted long enough to count yet). */
  private alive(c: Conn) {
    return c.ws.readyState === c.ws.OPEN && performance.now() - c.lastSeen < this.lease;
  }
  private fresh(c: Conn) {
    return this.alive(c) && performance.now() - c.connectedAt >= this.lease;
  }

  private async quorum() {
    const backupId = this.backupNodeId();
    const others = (await this.store.listNodes()).filter((n) => !n.isServer && n.id !== backupId);
    const count = (ok: (c: Conn) => boolean) =>
      others.filter((n) => [...(this.stations.get(n.id) ?? [])].some(ok)).length;
    return {
      backupId,
      others: others.length,
      connected: count((c) => this.fresh(c)),
      reachable: count((c) => this.alive(c)),
    };
  }

  /**
   * The network-split rule. 'waiting' = the computers needed are connected, but only just (or this
   * main computer only just started): registering starts as soon as they have lasted LEASE.
   */
  async registerState(): Promise<'ok' | 'waiting' | 'paused' | 'not-main'> {
    if (this.role !== 'main') return 'not-main';
    const q = await this.quorum();
    if (!q.backupId && this.metaSync('needs_backup') !== '1') return 'ok';
    const settled = performance.now() - this.startedAt >= this.lease;
    const backup = this.backup && this.backup.nodeId === q.backupId ? this.backup : null;
    const majority = (n: number) => n * 2 > q.others && q.others > 0;
    if (settled) {
      if (!q.backupId) return 'ok';
      if (backup && this.fresh(backup)) return 'ok';
      if (majority(q.connected)) return 'ok';
    }
    // Would the rule hold once the new connections (or this start) are old enough?
    const soon = !q.backupId || (backup && this.alive(backup)) || majority(q.reachable);
    return soon ? 'waiting' : 'paused';
  }

  async status(): Promise<ClusterStatus> {
    const q = await this.quorum();
    const nodes = await this.store.listNodes();
    const b = q.backupId ? nodes.find((n) => n.id === q.backupId) : undefined;
    return {
      term: this.term(),
      role: this.role,
      backup: q.backupId
        ? {
            nodeId: q.backupId,
            name: b?.name ?? '',
            connected: !!this.backup && this.backup.ws.readyState === this.backup.ws.OPEN,
            lastCopiedAt: this.store.getLocalSync('backup_copied_at') || null,
            copyProgress: this.copyProgress(),
            upToDate:
              !!this.backup &&
              this.backup.ws.readyState === this.backup.ws.OPEN &&
              !this.backup.copy &&
              this.backup.ackedSeq >= this.store.replLastSeq(),
          }
        : null,
      needsBackup: this.metaSync('needs_backup') === '1',
      registerState: await this.registerState(),
      connectedStations: q.connected,
      otherStations: q.others,
      conflicts: await this.store.listConflicts(),
      otherSystems: this.otherSystems,
    };
  }

  // ---------------- replication to the backup ----------------

  /** The backup connected to /replicate, telling us what it already has. */
  attachBackup(ws: WebSocket, nodeId: string, source: string, seq: number) {
    this.backup?.ws.close(4004, 'replaced');
    const now = performance.now();
    const conn: BackupConn = {
      ws,
      nodeId,
      connectedAt: now,
      lastSeen: now,
      sentSeq: 0,
      ackedSeq: 0,
      snapshotting: false,
      copy: null,
    };
    this.backup = conn;
    log.info(`backup ${nodeId.slice(0, 8)} connected (has change ${seq})`);
    ws.on('pong', () => (conn.lastSeen = performance.now()));
    ws.on('message', (data) => this.onBackupMessage(conn, String(data)));
    ws.on('close', () => {
      if (this.backup === conn) {
        this.backup = null;
        log.warn('backup disconnected: data is not being copied');
        if (!this.closed) this.opts.broadcast({ type: 'cluster-changed' });
      }
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    send({ t: 'hello', source: this.sourceId(), term: this.term() });
    const last = this.store.replLastSeq();
    const oldest = this.store.replOldestSeq();
    // Can it continue from where it is? Same history, and every later change still kept.
    const continues =
      source === this.sourceId() &&
      seq <= last &&
      (seq === last || (oldest > 0 && oldest <= seq + 1));
    if (continues) {
      conn.sentSeq = seq;
      conn.ackedSeq = seq;
      // Tells the backup how far the main computer is (it confirms, even if nothing is new).
      send({ t: 'changes', entries: [], head: last });
    } else {
      // The full copy always comes from this main computer's own database (never from a
      // previous backup: only the main computer serves /replicate).
      conn.snapshotting = true;
      const snap = this.store.replSnapshot();
      const total = Object.values(snap.tables).reduce((n, rows) => n + (rows?.length ?? 0), 0);
      conn.copy = { seq: snap.seq, total, received: 0, reportedAt: 0 };
      log.info(`sending the backup a full copy: ${total} rows (up to change ${snap.seq})`);
      send({ t: 'snap-begin', seq: snap.seq, total });
      for (const [tbl, rows] of Object.entries(snap.tables)) {
        for (let i = 0; i < (rows?.length ?? 0); i += SNAPSHOT_BATCH) {
          send({ t: 'snap-rows', tbl, rows: rows!.slice(i, i + SNAPSHOT_BATCH) });
        }
      }
      send({ t: 'snap-end', seq: snap.seq });
      conn.sentSeq = snap.seq;
      conn.snapshotting = false;
    }
    this.opts.broadcast({ type: 'cluster-changed' });
    this.kick();
  }

  private onBackupMessage(conn: BackupConn, raw: string) {
    conn.lastSeen = performance.now();
    let m: { t?: string; seq?: number; received?: number };
    try {
      m = JSON.parse(raw) as typeof m;
    } catch {
      return;
    }
    if (m.t === 'progress' && conn.copy && typeof m.received === 'number') {
      conn.copy.received = Math.min(conn.copy.total, m.received);
      // Admin screens follow the full copy (at most twice a second).
      const now = performance.now();
      if (now - conn.copy.reportedAt >= 500) {
        conn.copy.reportedAt = now;
        this.opts.broadcast({ type: 'backup-progress' });
      }
      return;
    }
    if (m.t !== 'ack' || typeof m.seq !== 'number') return;
    conn.ackedSeq = Math.max(conn.ackedSeq, m.seq);
    if (conn.copy && conn.ackedSeq >= conn.copy.seq) {
      log.info('the backup has the full copy');
      conn.copy = null;
      this.store.setLocalSync('backup_copied_at', this.opts.now().toISOString());
      this.opts.broadcast({ type: 'cluster-changed' });
    }
    this.store.setLocalSync('repl_acked_seq', String(conn.ackedSeq));
    if (conn.ackedSeq >= this.store.replLastSeq()) {
      this.store.setLocalSync('backup_copied_at', this.opts.now().toISOString());
    }
    for (const w of this.waiters) if (conn.ackedSeq >= w.seq) w.done();
    // The backup has these: a retired main keeps them (hand-over needs only later ones).
    this.store.replPruneThrough(conn.ackedSeq);
  }

  /** While the backup receives its full copy: how much it has (0–100), else null. */
  private copyProgress(): number | null {
    const c = this.backup?.copy;
    if (!c) return null;
    return Math.min(99, Math.floor((c.received / Math.max(1, c.total)) * 100));
  }

  /** Sends the backup every change it does not have yet. */
  kick() {
    const b = this.backup;
    if (!b) {
      // No backup connected. With no backup at all, nobody needs the changes kept.
      if (!this.backupNodeId() && this.role === 'main') {
        this.store.replPruneThrough(this.store.replLastSeq());
      }
      return;
    }
    if (b.snapshotting || b.ws.readyState !== b.ws.OPEN) return;
    const head = this.store.replLastSeq();
    while (b.sentSeq < head) {
      const entries: ReplEntry[] = this.store.replEntriesAfter(b.sentSeq, CHANGES_BATCH);
      if (entries.length === 0) break;
      b.ws.send(JSON.stringify({ t: 'changes', entries, head }));
      b.sentSeq = entries[entries.length - 1]!.seq;
    }
  }

  /**
   * After a write: when the backup is connected, wait (at most 2 s) until it confirms it has
   * everything up to `seq`. Returns whether it did.
   */
  async confirm(seq: number): Promise<boolean> {
    const b = this.backup;
    if (!b || b.ws.readyState !== b.ws.OPEN) return false;
    this.kick();
    if (b.ackedSeq >= seq) return true;
    return new Promise<boolean>((resolve) => {
      const w = {
        seq,
        done: () => {
          clearTimeout(timer);
          this.waiters.delete(w);
          resolve(true);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(w);
        log.warn(`backup did not confirm change ${seq} within ${this.ackWait} ms`);
        resolve(false);
      }, this.ackWait);
      this.waiters.add(w);
    });
  }

  close() {
    this.closed = true;
    for (const w of this.waiters) w.done();
  }
}
