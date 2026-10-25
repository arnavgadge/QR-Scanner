/**
 * A station's link to the main computer: finds it (by server ID, via discovery or a fixed local
 * address), calls operations over pinned TLS, keeps a live event channel, and reports the link
 * state:
 *   connecting -> online -> offline (keeps retrying) | update-required | revoked
 * When the server cannot be reached nothing is queued: calls fail with "server unreachable" and
 * the link keeps looking (re-asking the network, so a new IP address is picked up within seconds).
 *
 * Backup main computer: the link pins BOTH the main computer's and the backup's certificates
 * (shared by the main computer over this pinned connection) and follows the highest term. Before
 * using a server it asks it `hello`: a server of a lower term, or one that is no longer the main
 * computer, is skipped and the next one found on the network is tried. Every request carries the
 * highest term known (x-term), so a former main computer that comes back learns it was replaced.
 */
import { Agent } from 'node:https';
import WebSocket from 'ws';
import { msg } from '../../../web/src/i18n/core';
import { AppError } from '../../../web/src/services/errors';
import type { ConnectionState } from '../../../web/src/data/DataService';
import type {
  ClusterInfo,
  OpIn,
  OpName,
  OpOut,
  ServerEvent,
  StationProfile,
  WireResult,
} from '../../../web/src/desktop/protocol';
import type { FoundServer } from '../net/discovery';
import { describeError, logger } from '../log';
import { NetworkError, pinnedTlsAny, postJson, type Endpoint } from './https';

const log = logger('link');

export interface StationCredentials {
  serverId: string;
  nodeId: string;
  nodeToken: string;
  certPem: string;
  /** Other certificates of this system (the backup, former main computers). */
  knownCerts?: string[];
  /** Highest term known (1 if never promoted). */
  term?: number;
}

/** Where servers are heard about (mDNS in the app; a fake in tests). */
export interface DiscoverySource {
  /** `onLost`: a server stopped announcing itself (optional). */
  start(onFound: (server: FoundServer) => void, onLost?: (server: FoundServer) => void): void;
  refresh(): void;
  stop(): void;
}

export interface LinkOptions {
  credentials: StationCredentials;
  appVersion: string;
  /** Fixed address (the server computer's own window uses 127.0.0.1). */
  fixed?: Endpoint;
  discovery?: DiscoverySource;
  onState?: (state: ConnectionState) => void;
  onEvent?: (event: ServerEvent) => void;
  /** The main computer answered `hello`: its cluster info (to save) and this station's profile. */
  onCluster?: (cluster: ClusterInfo, station: StationProfile) => void;
  /** Reconnect delay after a lost connection. */
  retryMs?: number;
}

/** Most certificates remembered (current main, backup, a few former ones). */
const MAX_PINS = 6;
const SKIP_MS = 15_000;

const key = (e: Endpoint) => `${e.host}:${e.port}`;

export class ServerLink {
  private endpoint: Endpoint | null = null;
  private ws: WebSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private closed = false;
  private connecting = false;
  private _state: ConnectionState = 'connecting';
  /** Last failure logged, to collapse identical repeats while retrying every few seconds. */
  private lastFailure = { text: '', count: 0, at: 0 };
  private tls;
  private pins: string[];
  private _term: number;
  private _cluster: ClusterInfo | null = null;
  /** Servers heard about on the network, by computer (instance) or address. */
  private readonly found = new Map<string, Endpoint>();
  /** Servers not to try again for a while (lower term, no longer main, unreachable). */
  private readonly skip = new Map<string, number>();
  private readonly agent = new Agent({ keepAlive: true, maxSockets: 8 });

  constructor(private readonly opts: LinkOptions) {
    const c = opts.credentials;
    this.pins = [...new Set([c.certPem, ...(c.knownCerts ?? [])])].slice(0, MAX_PINS);
    this._term = Math.max(1, c.term ?? 1);
    this.tls = pinnedTlsAny(this.pins);
    this.endpoint = opts.fixed ?? null;
    log.info(
      opts.fixed
        ? `connecting to this computer's own server at ${opts.fixed.host}:${opts.fixed.port}`
        : `looking for the main computer ${c.serverId.slice(0, 8)} on the network (term ${this._term})`,
    );
    opts.discovery?.start((found) => this.onFound(found));
    this.connectEvents();
  }

  get state(): ConnectionState {
    return this._state;
  }

  /** Where the main computer is right now (Advanced section only). */
  get address(): Endpoint | null {
    return this.endpoint;
  }

  get term(): number {
    return this._term;
  }

  /** What the main computer said about the system last time (null before the first answer). */
  get cluster(): ClusterInfo | null {
    return this._cluster;
  }

  /** The certificates trusted right now (to save). */
  get knownCerts(): string[] {
    return [...this.pins];
  }

  /** For the backup's copy channel: the verified main computer and how to talk to it. */
  connection(): {
    endpoint: Endpoint;
    tls: ReturnType<typeof pinnedTlsAny>;
    headers: Record<string, string>;
  } | null {
    if (this._state !== 'online' || !this.endpoint) return null;
    return { endpoint: this.endpoint, tls: this.tls, headers: this.headers() };
  }

  /** Calls an operation. `session` = the signed-in person's session token, if any. */
  async call<K extends OpName>(op: K, input: OpIn<K>, session?: string | null): Promise<OpOut<K>> {
    if (this._state === 'revoked') throw new AppError('revoked', msg('server.revoked'));
    const endpoint = this.endpoint;
    if (!endpoint) {
      this.failed(`${op}: the main computer has not been found on the network yet`);
      this.opts.discovery?.refresh();
      throw new AppError('server-unreachable', msg('server.unreachable'));
    }
    let res;
    try {
      res = await postJson(
        endpoint,
        `/api/${op}`,
        input,
        this.headers(session),
        this.tls,
        this.agent,
      );
    } catch (e) {
      if (e instanceof NetworkError) {
        this.failed(`${op} to ${endpoint.host}:${endpoint.port} failed: ${e.message}`);
        this.lost();
        throw new AppError('server-unreachable', msg('server.unreachable'));
      }
      throw e;
    }
    const result = res.body as WireResult<OpOut<K>> | null;
    if (!result) {
      this.failed(
        `${op}: unreadable answer from ${endpoint.host}:${endpoint.port} (HTTP ${res.status})`,
      );
      throw new AppError('server-unreachable', msg('server.unreachable'));
    }
    if (result.ok) return result.data;
    if (result.error.code === 'update-required' || result.error.code === 'revoked') {
      this.failed(`${op} refused by the server: ${result.error.code} (${result.error.message})`);
      this.setState(result.error.code);
    }
    if (result.error.code === 'not-main' && !this.opts.fixed) {
      // That computer was replaced: find the new main computer.
      this.skipFor(endpoint, `${key(endpoint)} is no longer the main computer`);
      this.reconnect();
    }
    throw new AppError(result.error.code, result.error.msg ?? result.error.message);
  }

  /** Re-reads the system (after a cluster-changed event): new backup certificate, term, role. */
  async refreshCluster() {
    const endpoint = this.endpoint;
    if (!endpoint) return;
    try {
      const verdict = await this.verify(endpoint);
      if (verdict !== 'ok' && !this.opts.fixed) this.reconnect();
    } catch {
      // the live connection notices on its own
    }
  }

  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.terminate();
    this.opts.discovery?.stop();
    this.agent.destroy();
  }

  private headers(session?: string | null): Record<string, string> {
    return {
      'x-app-version': this.opts.appVersion,
      'x-node-token': this.opts.credentials.nodeToken,
      'x-term': String(this._term),
      ...(session ? { 'x-session': session } : {}),
    };
  }

  private onFound(found: FoundServer) {
    if (found.serverId !== this.opts.credentials.serverId || this.opts.fixed) return;
    const id = found.instance ?? key(found);
    const endpoint = { host: found.host, port: found.port };
    const before = this.found.get(id);
    if (before && key(before) === key(endpoint)) return;
    this.found.set(id, endpoint);
    log.info(
      `found ${found.serverId.slice(0, 8)}${found.instance ? ` (computer ${found.instance.slice(0, 8)})` : ''} at ${found.host}:${found.port}`,
    );
    const current = this.endpoint;
    if (before && current && key(before) === key(current)) {
      // The server we use moved to a new address: reconnect now.
      this.reconnect();
    } else if (this._state !== 'online') {
      this.scheduleConnect(0);
    }
  }

  private reconnect() {
    this.endpoint = null;
    this.ws?.terminate();
    this.ws = null;
    this.scheduleConnect(0);
  }

  private skipFor(e: Endpoint, why: string, ms = SKIP_MS) {
    log.warn(`skipping ${key(e)} for ${Math.round(ms / 1000)} s: ${why}`);
    this.skip.set(key(e), Date.now() + ms);
  }

  /** Servers to try, in order: the one in use, then everything heard about. */
  private candidates(): Endpoint[] {
    if (this.opts.fixed) return [this.opts.fixed];
    const now = Date.now();
    const all = [...(this.endpoint ? [this.endpoint] : []), ...this.found.values()];
    const unique = [...new Map(all.map((e) => [key(e), e])).values()];
    return unique.filter((e) => (this.skip.get(key(e)) ?? 0) <= now);
  }

  /**
   * Asks a server who it is. 'ok' = the main computer of the highest term (adopted); 'skip' = not
   * one to use; throws NetworkError if it cannot be reached.
   */
  private async verify(endpoint: Endpoint): Promise<'ok' | 'skip' | 'refused'> {
    const res = await postJson(endpoint, '/api/hello', {}, this.headers(), this.tls, this.agent);
    const result = res.body as WireResult<OpOut<'hello'>> | null;
    if (!result) return 'skip';
    if (!result.ok) {
      if (result.error.code === 'update-required' || result.error.code === 'revoked') {
        this.failed(`refused by ${key(endpoint)}: ${result.error.code} (${result.error.message})`);
        this.setState(result.error.code);
        return 'refused';
      }
      return 'skip';
    }
    const { cluster, station } = result.data;
    if (cluster.term < this._term) {
      this.skipFor(endpoint, `older term ${cluster.term} (this station knows term ${this._term})`);
      return 'skip';
    }
    if (cluster.role !== 'main' && !this.opts.fixed) {
      this.skipFor(endpoint, 'no longer the main computer');
      return 'skip';
    }
    if (cluster.term > this._term) log.info(`following term ${cluster.term} (was ${this._term})`);
    this._term = cluster.term;
    // Trust exactly what the (pinned) main computer says: itself, its backup, and keep older ones
    // so a former main computer can still be told it was replaced.
    const pins = [
      ...new Set(
        [cluster.certPem, cluster.backup?.certPem ?? null, ...this.pins].filter(
          (p): p is string => !!p,
        ),
      ),
    ].slice(0, MAX_PINS);
    if (pins.join() !== this.pins.join()) {
      this.pins = pins;
      this.tls = pinnedTlsAny(pins);
    }
    this._cluster = cluster;
    this.opts.onCluster?.(cluster, station);
    return 'ok';
  }

  private connectEvents() {
    if (this.closed || this.ws || this.connecting || this._state === 'revoked') return;
    void this.connectNext();
  }

  private async connectNext() {
    this.connecting = true;
    try {
      const list = this.candidates();
      if (list.length === 0) {
        this.failed('live connection: the main computer has not been found on the network yet');
        this.setState(this._state === 'online' ? 'offline' : this._state);
        this.opts.discovery?.refresh();
        return this.scheduleConnect();
      }
      for (const endpoint of list) {
        if (this.closed) return;
        let verdict: 'ok' | 'skip' | 'refused';
        try {
          verdict = await this.verify(endpoint);
        } catch (e) {
          this.failed(`${key(endpoint)} cannot be reached: ${describeError(e)}`);
          if (!this.opts.fixed && list.length > 1) this.skipFor(endpoint, 'unreachable', 3_000);
          continue;
        }
        if (verdict === 'refused') return this.scheduleConnect(10_000);
        if (verdict === 'skip') continue;
        this.endpoint = endpoint;
        this.openEvents(endpoint);
        return;
      }
      this.lost();
    } finally {
      this.connecting = false;
    }
  }

  private openEvents(endpoint: Endpoint) {
    const ws = new WebSocket(`wss://${endpoint.host}:${endpoint.port}/events`, {
      ...this.tls,
      headers: this.headers(),
      handshakeTimeout: 5_000,
    });
    this.ws = ws;
    ws.on('open', () => this.setState('online'));
    ws.on('message', (data) => {
      try {
        const event = JSON.parse(String(data)) as ServerEvent;
        if (event.type === 'cluster-changed') void this.refreshCluster();
        this.opts.onEvent?.(event);
      } catch {
        // ignore malformed events
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      const code = res.headers['x-error-code'];
      this.failed(
        `live connection to ${endpoint.host}:${endpoint.port} refused: HTTP ${res.statusCode}${code ? ` (${String(code)})` : ''}`,
      );
      if (code === 'update-required') this.setState('update-required');
      if (code === 'revoked') this.setState('revoked');
      ws.terminate();
    });
    ws.on('error', (e) =>
      this.failed(
        `live connection to ${endpoint.host}:${endpoint.port} failed: ${describeError(e)}`,
      ),
    );
    ws.on('close', (code, reason) => {
      if (this.ws === ws) this.ws = null;
      if (!this.closed && this._state === 'online') {
        log.warn(
          `live connection closed (code ${code}${reason.length ? `, ${reason.toString()}` : ''})`,
        );
      }
      if (code === 4001) return this.setState('revoked');
      if (this.closed) return;
      if (code === 4003 && !this.opts.fixed) {
        this.skipFor(endpoint, 'it is no longer the main computer');
        this.endpoint = null;
      }
      this.lost();
    });
  }

  /** The connection failed: report it, ask the network where the server is, retry. */
  private lost() {
    if (this._state === 'revoked' || this._state === 'update-required') {
      return this.scheduleConnect(10_000);
    }
    this.setState('offline');
    if (!this.opts.fixed) this.opts.discovery?.refresh();
    this.scheduleConnect();
  }

  private scheduleConnect(delay = this.opts.retryMs ?? 2_000) {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connectEvents();
    }, delay);
    this.retry.unref?.();
  }

  /** Logs a failure with its reason; identical repeats are counted and logged every 30 s. */
  private failed(text: string) {
    const now = Date.now();
    const same = text === this.lastFailure.text;
    if (same && now - this.lastFailure.at < 30_000) {
      this.lastFailure.count += 1;
      return;
    }
    const repeats =
      same && this.lastFailure.count > 0 ? ` (repeated ${this.lastFailure.count} more times)` : '';
    log.warn(text + repeats);
    this.lastFailure = { text, count: 0, at: now };
  }

  private setState(next: ConnectionState) {
    if (next === this._state) return;
    log.info(`state: ${this._state} -> ${next}`);
    if (next === 'online') this.lastFailure = { text: '', count: 0, at: 0 };
    this._state = next;
    this.opts.onState?.(next);
  }
}
