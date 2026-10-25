/**
 * What this computer runs, in the Electron main process:
 *  - Server mode: the server (database, API, announcement) AND a station link for this computer's
 *    own window (to 127.0.0.1, same rules as every other station).
 *  - Station mode: a station link that finds the server by its ID on the network. If the main
 *    computer made this station the backup, it also keeps a copy of all data (replica.ts) and can
 *    be made the main computer ("promotion").
 *  - A former main computer (retired after a promotion) hands over what the new main computer may
 *    be missing, then becomes a station re-using its own pairing.
 * The signed-in person's session lives here, never in the page.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { msg } from '../../../web/src/i18n/core';
import { AppError } from '../../../web/src/services/errors';
import {
  OP_ACCESS,
  type ClusterInfo,
  type HandoverResult,
  type OpIn,
  type OpName,
  type OpOut,
  type WireError,
  type WireResult,
} from '../../../web/src/desktop/protocol';
import type {
  DesktopEvent,
  DesktopInfo,
  DiscoveredServer,
  PromoteInput,
  SignedIn,
} from '../../../web/src/desktop/bridge';
import type { ConnectionState } from '../../../web/src/data/DataService';
import { lanAddresses, ServerBrowser, type FoundServer } from '../net/discovery';
import { ServerLink, type DiscoverySource } from '../node/link';
import { Replica } from '../node/replica';
import { httpsPairTransport, pairWithServer } from '../node/pairingClient';
import { checkRecoveryCode, issueRecoveryCode } from '../server/api';
import { loadOrCreateIdentity } from '../server/certificate';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../server/secrets';
import { startServer, type RunningServer } from '../server/server';
import { SqliteStore } from '../server/store';
import { describeError, logger } from '../log';
import {
  stationCredentials,
  storeStation,
  type RuntimeDeps,
  type StoredConfig,
} from './configModel';

const log = logger('app');

const ok = <T>(data: T): WireResult<T> => ({ ok: true, data });
function wireError(e: unknown): { ok: false; error: WireError } {
  if (e instanceof AppError) {
    return {
      ok: false,
      error: { code: e.code, message: e.message, ...(e.msg ? { msg: e.msg } : {}) },
    };
  }
  log.error(`unexpected error: ${describeError(e)}`);
  const m = msg('errors.generic');
  return {
    ok: false,
    error: { code: 'unknown', message: new AppError('unknown', m).message, msg: m },
  };
}

/** mDNS discovery as a DiscoverySource for the station link. */
function mdnsDiscovery(requeryMs?: number): DiscoverySource {
  let browser: ServerBrowser | null = null;
  return {
    start: (onFound, onLost) => {
      browser = new ServerBrowser(onFound, requeryMs, onLost);
    },
    refresh: () => browser?.refresh(),
    stop: () => browser?.close(),
  };
}

/** 5 wrong passwords or codes on the promotion screen: 5 minutes pause. */
class Attempts {
  private wrong = 0;
  private until = 0;
  check() {
    if (Date.now() < this.until) throw new AppError('locked', msg('auth.tooManyAttempts'));
  }
  failed() {
    this.wrong += 1;
    if (this.wrong >= 5) {
      this.wrong = 0;
      this.until = Date.now() + 5 * 60_000;
    }
  }
  succeeded() {
    this.wrong = 0;
  }
}

export class Runtime {
  private config: StoredConfig;
  private server: RunningServer | null = null;
  private link: ServerLink | null = null;
  /** On the backup: the copy of all data, and what keeps it current. */
  private replicaStore: SqliteStore | null = null;
  private replica: Replica | null = null;
  /** One at a time: two at once could each create a certificate. */
  private backupSetup: Promise<void> | null = null;
  /** Newest cluster info seen (term, revision): older answers are ignored. */
  private seen = { term: 0, revision: -1 };
  /** An administrator's sign-in (stations themselves never sign in). */
  private session: {
    token: string;
    user: SignedIn;
    idleMs: number;
    timer: NodeJS.Timeout;
  } | null = null;
  private setupBrowser: DiscoverySource | null = null;
  /** Main computer: other systems' main computers seen on the network (by server ID). */
  private rivalWatch: DiscoverySource | null = null;
  private readonly rivals = new Map<string, FoundServer>();
  private readonly found = new Map<string, FoundServer>();
  private readonly attempts = new Attempts();
  private busy = false;
  /** Main computer: looks for a promoted backup (a newer main computer) on the network. */
  private probe: { link: ServerLink; cert: string } | null = null;
  private probeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly appVersion: string,
    private readonly emit: (event: DesktopEvent) => void,
    private readonly deps: RuntimeDeps,
  ) {
    this.config = deps.loadConfig();
  }

  private save() {
    // The printer choice is saved by the window (main.ts) directly: keep what is on disk.
    this.deps.saveConfig({ ...this.config, printer: this.deps.loadConfig().printer });
  }

  private credentials() {
    return stationCredentials(this.config, this.deps.reveal);
  }

  /** This computer's name on the network. */
  private get computerName() {
    return this.deps.computerName ?? hostname();
  }

  private discovery(requeryMs?: number): DiscoverySource {
    return this.deps.discovery?.() ?? mdnsDiscovery(requeryMs);
  }

  /**
   * Listens on the network for `ms`: the main computers announcing themselves (any system). A
   * retired main computer and a backup do not announce, so every answer is an active one.
   */
  private searchMainComputers(ms: number): Promise<FoundServer[]> {
    return new Promise((resolve) => {
      const found = new Map<string, FoundServer>();
      const source = this.discovery(1_000);
      source.start((s) => found.set(s.serverId, s));
      setTimeout(() => {
        source.stop();
        resolve([...found.values()]);
      }, ms);
    });
  }

  private startOwnServer() {
    const timing = this.deps.serverTiming;
    return startServer({
      computerName: this.computerName,
      dataDir: this.deps.serverDataDir,
      version: this.appVersion,
      ...(this.deps.serverPort !== undefined ? { port: this.deps.serverPort } : {}),
      ...(this.deps.announce ? { announce: false } : {}),
      ...(timing ? { heartbeatMs: timing.heartbeatMs, leaseMs: timing.leaseMs } : {}),
    }).then((server) => {
      if (this.deps.announce) {
        const stop = this.deps.announce({
          serverId: server.serverId,
          port: server.port,
          instance: server.fingerprint.replace(/:/g, '').slice(0, 16),
          computerName: this.computerName,
        });
        const close = server.close;
        server.close = async () => {
          stop();
          await close();
        };
      }
      return server;
    });
  }

  get mode() {
    return this.config.mode;
  }

  /** The server running on this computer (main computer only). */
  get runningServer(): RunningServer | null {
    return this.server;
  }

  /** Starts whatever this computer is set up to be. */
  async start(): Promise<void> {
    log.info(
      `starting as ${this.config.mode ?? 'not set up yet (first-run setup)'}${this.config.backup ? ' (backup main computer)' : ''}, app version ${this.appVersion}`,
    );
    try {
      if (this.config.mode === 'server') await this.startServerMode();
      if (this.config.mode === 'node') {
        this.startStationLink();
        // The copy can be promoted even while the main computer is unreachable.
        if (this.config.backup) this.openReplicaStore();
      }
    } catch (e) {
      log.error(`could not start: ${describeError(e)}`);
      throw e;
    }
  }

  async stop(): Promise<void> {
    this.stopProbe();
    this.stopWatchingOtherSystems();
    this.endSession();
    this.stopBackup();
    this.link?.close();
    this.link = null;
    this.setupBrowser?.stop();
    await this.server?.close();
    this.server = null;
  }

  private role(): DesktopInfo['role'] {
    if (this.config.mode === 'server') {
      return this.server?.cluster.role === 'retired' ? 'retired' : 'main';
    }
    if (this.config.mode === 'node') return this.config.backup ? 'backup' : 'station';
    return null;
  }

  info(): DesktopInfo {
    const addr = this.link?.address;
    const copy = this.replica?.status();
    return {
      mode: this.config.mode,
      appVersion: this.appVersion,
      stationName: this.config.stationName,
      connection: this.link?.state ?? 'connecting',
      serverId: this.config.station?.serverId ?? null,
      serverAddress: addr && this.config.mode === 'node' ? `${addr.host}:${addr.port}` : null,
      lanAddresses: this.config.mode === 'server' ? lanAddresses() : [],
      dbFile: this.server?.dbFile ?? null,
      role: this.role(),
      term: this.server?.cluster.term() ?? this.link?.term ?? this.config.station?.term ?? 1,
      backupCopy:
        this.config.mode === 'node' && this.config.backup
          ? {
              receiving: copy?.connected ?? false,
              lastCopiedAt:
                copy?.lastCopiedAt ?? this.replicaStore?.getLocalSync('repl_synced_at') ?? null,
              complete: this.replica?.caughtUp() ?? false,
              everComplete: copy?.everComplete ?? this.replicaStore?.replEverComplete() ?? false,
              copyProgress: copy?.copyProgress ?? null,
            }
          : null,
    };
  }

  signedIn(): SignedIn | null {
    return this.session?.user ?? null;
  }

  // ---------------- first-run setup ----------------

  async setupServer(admin: {
    name: string;
    email: string;
    password: string;
  }): Promise<WireResult<{ recoveryCode: string }>> {
    try {
      if (this.config.mode) throw new AppError('invalid-data', msg('setup.adminExists'));
      // One main computer per network: look first.
      const searchMs = this.deps.searchMs ?? 4_000;
      const existing = searchMs > 0 ? await this.searchMainComputers(searchMs) : [];
      if (existing.length > 0) {
        const names = existing.map((s) => s.label || s.serverId.slice(0, 8).toUpperCase());
        log.warn(`setup as main computer refused: ${names.join(', ')} already on this network`);
        throw new AppError('invalid-data', msg('setup.mainExists', { name: names.join(', ') }));
      }
      log.info('setting up this computer as the main computer');
      const server = await this.startOwnServer();
      let recoveryCode: string;
      try {
        if (!(await server.hasAdmin())) await server.createFirstAdmin(admin);
        recoveryCode = await issueRecoveryCode(server.store);
      } catch (e) {
        await server.close();
        throw e;
      }
      this.server = server;
      const creds = await server.createServerStation();
      this.config = storeStation(
        { ...this.config, mode: 'server', stationName: 'Main computer' },
        { ...creds, serverId: server.serverId, certPem: server.certPem },
        this.deps.protect,
      );
      this.save();
      this.startStationLink();
      this.watchForOtherSystems();
      return ok({ recoveryCode });
    } catch (e) {
      return wireError(e);
    }
  }

  startDiscovery() {
    this.setupBrowser?.stop();
    this.found.clear();
    const source = this.discovery(2_000);
    source.start(
      (s) => {
        this.found.set(s.serverId, s);
        this.emit({ type: 'discovery', servers: this.discovered() });
      },
      (s) => {
        if (this.found.get(s.serverId)?.instance !== s.instance) return;
        this.found.delete(s.serverId);
        this.emit({ type: 'discovery', servers: this.discovered() });
      },
    );
    this.setupBrowser = source;
  }

  stopDiscovery() {
    this.setupBrowser?.stop();
    this.setupBrowser = null;
  }

  /**
   * Main computer: watch for main computers of OTHER systems (another server ID) on the network;
   * admins on both are warned. A promoted backup or a former main computer of this system has the
   * same server ID, so it is never one.
   */
  private watchForOtherSystems() {
    this.stopWatchingOtherSystems();
    const server = this.server;
    if (!server) return;
    const update = () => {
      this.server?.cluster.setOtherSystems(
        [...this.rivals.values()].map((r) => ({
          serverId: r.serverId,
          name: r.label || r.serverId.slice(0, 8).toUpperCase(),
        })),
      );
    };
    const source = this.discovery(5_000);
    source.start(
      (s) => {
        if (s.serverId === server.serverId) return;
        if (!this.rivals.has(s.serverId)) {
          log.warn(`another system's main computer is on this network: ${s.label ?? s.serverId}`);
        }
        this.rivals.set(s.serverId, s);
        update();
      },
      (s) => {
        if (this.rivals.delete(s.serverId)) update();
      },
    );
    this.rivalWatch = source;
  }

  private stopWatchingOtherSystems() {
    this.rivalWatch?.stop();
    this.rivalWatch = null;
    this.rivals.clear();
  }

  private discovered(): DiscoveredServer[] {
    return [...this.found.values()].map((s) => ({
      serverId: s.serverId,
      label: s.serverId.slice(0, 8).toUpperCase(),
      name: s.label ?? '',
      host: s.host,
      port: s.port,
    }));
  }

  /** Pairs with the code; the station gets its name on the station setup screen right after. */
  async pairStation(input: { server: DiscoveredServer; code: string }): Promise<WireResult<null>> {
    try {
      const secret = await pairWithServer({
        transport: httpsPairTransport({ host: input.server.host, port: input.server.port }),
        code: input.code,
        nodeName: '',
        appVersion: this.appVersion,
      });
      this.stopDiscovery();
      this.config = storeStation({ ...this.config, mode: 'node' }, secret, this.deps.protect);
      log.info(`paired with the main computer ${secret.serverId.slice(0, 8)}`);
      this.save();
      this.startStationLink();
      return ok(null);
    } catch (e) {
      return wireError(e);
    }
  }

  /** After an administrator removed this station: forget the pairing; setup starts again. */
  resetPairing() {
    if (this.config.mode !== 'node') return;
    this.endSession();
    this.stopBackup(true);
    this.link?.close();
    this.link = null;
    this.config = { ...this.config, mode: null, station: null, backup: false };
    this.save();
  }

  // ---------------- data calls from the page ----------------

  async call<K extends OpName>(op: K, input: OpIn<K>): Promise<WireResult<OpOut<K>>> {
    const link = this.link;
    if (!link) return wireError(new AppError('server-unreachable', msg('server.unreachable')));
    try {
      if (op === 'auth.login') {
        const r = (await link.call(
          'auth.login',
          input as OpIn<'auth.login'>,
        )) as OpOut<'auth.login'>;
        this.startSession(r.session, { uid: r.uid, email: r.email }, r.idleMinutes);
        // The session token stays here: the page only learns who signed in.
        return ok({ ...r, session: '' } as OpOut<K>);
      }
      if (op === 'auth.logout') {
        const token = this.session?.token;
        this.endSession();
        if (token) await link.call('auth.logout', {}, token).catch(() => undefined);
        return ok(null as OpOut<K>);
      }
      // Scanning goes out as the station alone; admin operations carry the admin's session.
      const needsPerson = OP_ACCESS[op] !== 'station';
      const data = await link.call(op, input, needsPerson ? this.session?.token : null);
      if (needsPerson) this.touchSession();
      return ok(data);
    } catch (e) {
      if (e instanceof AppError && e.code === 'session-expired') this.endSession();
      return wireError(e);
    }
  }

  // ---------------- backup main computer ----------------

  /** The main computer told us about the system (on every connection and change). */
  private onCluster(cluster: ClusterInfo, station: { nodeId: string }) {
    if (this.config.mode !== 'node' || !this.config.station) return;
    const older =
      cluster.term < this.seen.term ||
      (cluster.term === this.seen.term && cluster.revision < this.seen.revision);
    if (older) return; // an answer that was overtaken by a newer one
    this.seen = { term: cluster.term, revision: cluster.revision };
    // Remember who to trust and the term, so this station finds a promoted backup on its own.
    const link = this.link;
    if (link) {
      const s = this.config.station;
      const knownCerts = link.knownCerts.filter((c) => c !== s.certPem);
      if (s.term !== link.term || (s.knownCerts ?? []).join() !== knownCerts.join()) {
        this.config = {
          ...this.config,
          station: { ...s, term: link.term, knownCerts },
        };
        this.save();
      }
    }
    const amBackup = cluster.backup?.nodeId === station.nodeId;
    if (amBackup) {
      this.backupSetup ??= this.becomeBackup(cluster).finally(() => (this.backupSetup = null));
    } else if (this.config.backup) {
      log.info('this station is no longer the backup main computer: erasing its copy of the data');
      this.stopBackup(true);
      this.config = { ...this.config, backup: false };
      this.save();
      this.emit({ type: 'cluster' });
    }
  }

  private openReplicaStore() {
    if (!this.replicaStore) {
      mkdirSync(this.deps.serverDataDir, { recursive: true });
      this.replicaStore = new SqliteStore(join(this.deps.serverDataDir, 'serials.db'));
    }
    if (!this.replica && this.link) {
      this.replica = new Replica({
        store: this.replicaStore,
        link: this.link,
        retryMs: 500,
        onStatus: () => this.emit({ type: 'cluster' }),
      });
    }
    return this.replicaStore;
  }

  private async becomeBackup(cluster: ClusterInfo) {
    if (!this.config.backup) {
      log.info('this station is now the backup main computer: copying all data');
      this.config = { ...this.config, backup: true };
      this.save();
      this.emit({ type: 'cluster' });
    }
    this.openReplicaStore();
    // Its own certificate, shared by the main computer with every station in advance.
    const identity = await loadOrCreateIdentity(this.deps.serverDataDir, cluster.clusterId);
    if (cluster.backup?.certPem !== identity.certPem) {
      try {
        await this.link?.call('cluster.registerBackup', { certPem: identity.certPem });
      } catch (e) {
        log.warn(`could not hand the backup certificate to the main computer: ${describeError(e)}`);
      }
    }
  }

  /** Stops copying; `erase` deletes this computer's copy of the data. */
  private stopBackup(erase = false) {
    this.replica?.stop();
    this.replica = null;
    this.replicaStore?.close();
    this.replicaStore = null;
    if (erase && existsSync(this.deps.serverDataDir)) {
      rmSync(this.deps.serverDataDir, { recursive: true, force: true });
    }
  }

  /**
   * Makes this backup the main computer. Confirmed with an administrator's password (or the
   * recovery code, which then sets a new password). If the main computer can still be reached it
   * steps down first and hands over its last changes (planned switch); otherwise the administrator
   * must confirm that recent serials may be missing.
   */
  async promote(input: PromoteInput): Promise<WireResult<{ recoveryCode: string | null }>> {
    if (this.busy) return wireError(new AppError('invalid-data', msg('errors.generic')));
    this.busy = true;
    try {
      if (this.config.mode !== 'node' || !this.config.backup || !this.config.station) {
        throw new AppError('permission-denied', msg('promote.notBackup'));
      }
      const store = this.openReplicaStore();
      if ((await store.countUsers()) === 0)
        throw new AppError('invalid-data', msg('promote.noCopy'));
      this.attempts.check();

      const user = await store.getUserByEmail(
        String(input.email ?? '')
          .trim()
          .toLowerCase(),
      );
      const usingCode = !!input.recoveryCode;
      const valid =
        !!user &&
        user.role === 'admin' &&
        user.active &&
        (usingCode
          ? await checkRecoveryCode(store, input.recoveryCode!)
          : await verifyPassword(String(input.password ?? ''), user.passwordHash));
      if (!valid) {
        this.attempts.failed();
        throw new AppError(
          'invalid-credentials',
          msg(usingCode ? 'recovery.wrong' : 'auth.invalidCredentials'),
        );
      }
      this.attempts.succeeded();
      if (usingCode && String(input.newPassword ?? '').length < MIN_PASSWORD_LENGTH) {
        throw new AppError(
          'invalid-data',
          msg('users.passwordTooShort', { min: MIN_PASSWORD_LENGTH }),
        );
      }

      const link = this.link;
      const known = Math.max(Number(await store.getMeta('term')) || 1, link?.term ?? 1);
      const newTerm = known + 1;

      // Checked BEFORE asking the main computer to step down (never leave the system without one).
      if (!store.replEverComplete() && !input.understood) {
        throw new AppError('invalid-data', msg('promote.mustConfirm'));
      }

      // Planned switch: the main computer is reachable -> it steps down and we take every change.
      let planned = false;
      if (link?.state === 'online' && this.replica) {
        try {
          const { finalSeq } = await link.call('cluster.stepDown', { term: newTerm });
          planned = await this.replica.waitFor(finalSeq, 10_000);
          log.info(
            planned
              ? 'the main computer stepped down and handed over every change'
              : 'the main computer stepped down, but not every change arrived',
          );
        } catch (e) {
          log.warn(`the main computer could not step down: ${describeError(e)}`);
        }
      }
      // Never a complete copy (the main computer stopped during the first copy): most data may be
      // missing, so the same confirmation is needed even if the main computer stepped down.
      if ((!planned || !store.replEverComplete()) && !input.understood) {
        throw new AppError('invalid-data', msg('promote.mustConfirm'));
      }

      // From here on this computer is the main computer of the new term.
      log.warn(`making this computer the main computer (term ${newTerm})`);
      const station = this.config.station;
      this.replica?.stop();
      this.replica = null;
      link?.close();
      this.link = null;
      this.endSession();

      const nodeId = station.nodeId;
      await store.setMeta('term', String(newTerm));
      await store.setMeta('backup_node_id', '');
      await store.setMeta('backup_cert', '');
      await store.setMeta('needs_backup', '1');
      await store.setMeta(
        'cluster_rev',
        String((Number(await store.getMeta('cluster_rev')) || 0) + 1),
      );
      await store.setLocal('role', 'main');
      await store.setServerNode(nodeId);
      let recoveryCode: string | null = null;
      if (usingCode && user) {
        await store.setUserPassword(
          user.uid,
          await hashPassword(String(input.newPassword)),
          { uid: user.uid, name: user.name },
          new Date().toISOString(),
        );
        recoveryCode = await issueRecoveryCode(store);
      }
      store.replPruneThrough(store.replLastSeq());
      store.close();
      this.replicaStore = null;

      this.config = {
        ...this.config,
        mode: 'server',
        backup: false,
        station: { ...station, term: newTerm },
      };
      this.save();
      await this.startServerMode();
      this.emit({ type: 'cluster' });
      return ok({ recoveryCode });
    } catch (e) {
      return wireError(e);
    } finally {
      this.busy = false;
    }
  }

  /**
   * On a former main computer: sends the new main computer every serial, scan and import written
   * here after the backup last confirmed, then turns this computer into a station (its own pairing
   * is kept: the new main computer has the same station records).
   */
  async handover(input: { email: string; password: string }): Promise<WireResult<HandoverResult>> {
    if (this.busy) return wireError(new AppError('invalid-data', msg('errors.generic')));
    this.busy = true;
    let temp: ServerLink | null = null;
    try {
      const server = this.server;
      const creds = this.credentials();
      if (this.config.mode !== 'server' || !server || server.cluster.role !== 'retired' || !creds) {
        throw new AppError('permission-denied', msg('cluster.notRetired'));
      }
      const info = server.cluster.info();
      const term = Number(await server.store.getLocal('superseded_term')) || info.term + 1;
      // Find the new main computer: it is the backup this computer knew (same server ID).
      temp = new ServerLink({
        credentials: {
          ...creds,
          knownCerts: [info.backup?.certPem, ...(creds.knownCerts ?? [])].filter(
            (c): c is string => !!c && c !== creds.certPem,
          ),
          term,
        },
        appVersion: this.appVersion,
        discovery: this.deps.discovery?.() ?? mdnsDiscovery(),
        retryMs: 500,
      });
      const end = Date.now() + 15_000;
      while (temp.state !== 'online' && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (temp.state !== 'online' || !temp.cluster) {
        throw new AppError('server-unreachable', msg('cluster.newMainUnreachable'));
      }
      const { session } = await temp.call('auth.login', {
        email: input.email,
        password: input.password,
      });
      const records = server.store.pendingHandover();
      const result = await temp.call('cluster.handover', { records }, session);
      await temp.call('auth.logout', {}, session).catch(() => undefined);
      log.info(
        `handed over ${result.serialsAdded} serials (${result.conflicts} conflicts), ${result.scansAdded} scans, ${result.importsAdded} imports`,
      );

      // Now a station of the new main computer, with the same pairing.
      const newMain = temp.cluster;
      const station = this.config.station!;
      const knownCerts = temp.knownCerts.filter((c) => c !== newMain.certPem);
      temp.close();
      temp = null;
      this.stopProbe();
      this.stopWatchingOtherSystems();
      this.endSession();
      this.link?.close();
      this.link = null;
      await server.close();
      this.server = null;
      // Its data is on the new main computer now; a station keeps none.
      rmSync(this.deps.serverDataDir, { recursive: true, force: true });
      this.config = {
        ...this.config,
        mode: 'node',
        backup: false,
        station: { ...station, certPem: newMain.certPem, knownCerts, term: newMain.term },
      };
      this.save();
      this.startStationLink();
      this.emit({ type: 'cluster' });
      return ok(result);
    } catch (e) {
      return wireError(e);
    } finally {
      temp?.close();
      this.busy = false;
    }
  }

  /**
   * While this is the main computer: is its backup now serving as the main computer of a higher
   * term (promoted while this computer was off or cut off)? Then this one retires at once. The
   * probe trusts only the backup's certificate, so nothing else on the network can trigger it.
   */
  private watchForNewerMain() {
    this.stopProbe();
    const tick = () => {
      const server = this.server;
      const creds = this.credentials();
      if (!server || !creds || server.cluster.role !== 'main') return this.stopProbe();
      const cert = server.cluster.info().backup?.certPem ?? null;
      if (!cert) {
        this.probe?.link.close();
        this.probe = null;
        return;
      }
      if (this.probe?.cert !== cert) {
        this.probe?.link.close();
        const term = server.cluster.term();
        const link = new ServerLink({
          credentials: { ...creds, certPem: cert, knownCerts: [], term: term + 1 },
          appVersion: this.appVersion,
          discovery: this.deps.discovery?.() ?? mdnsDiscovery(),
          retryMs: 2_000,
          onCluster: (cluster) => {
            if (cluster.role === 'main' && cluster.term > server.cluster.term()) {
              server.cluster.retire(cluster.term, 'the backup is now the main computer');
              this.stopProbe();
              this.emit({ type: 'cluster' });
            }
          },
        });
        this.probe = { link, cert };
      }
    };
    tick();
    this.probeTimer = setInterval(tick, 5_000);
    this.probeTimer.unref?.();
  }

  private stopProbe() {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
    this.probe?.link.close();
    this.probe = null;
  }

  // ---------------- internals ----------------

  private async startServerMode() {
    this.server = await this.startOwnServer();
    const creds = this.credentials();
    if (!creds || creds.serverId !== this.server.serverId) {
      // Own-window credential missing or unreadable: make a new one (the old one is retired).
      log.info("creating a new credential for this computer's own window");
      const fresh = await this.server.createServerStation();
      this.config = storeStation(
        this.config,
        { ...fresh, serverId: this.server.serverId, certPem: this.server.certPem },
        this.deps.protect,
      );
      this.save();
    } else if (creds.certPem !== this.server.certPem) {
      // The server's certificate was replaced (e.g. an older one stations could not use), or a
      // promoted backup now serves with its own: this computer's own window simply takes it.
      log.info("this computer's own window now uses the server's certificate");
      this.config = storeStation(
        this.config,
        { ...creds, certPem: this.server.certPem },
        this.deps.protect,
      );
      this.save();
    }
    this.startStationLink();
    this.watchForNewerMain();
    this.watchForOtherSystems();
  }

  private startStationLink() {
    this.link?.close();
    const creds = this.credentials();
    if (!creds) return;
    const local = this.config.mode === 'server' && this.server;
    this.link = new ServerLink({
      credentials: local ? { ...creds, term: this.server!.cluster.term() } : creds,
      appVersion: this.appVersion,
      ...(local
        ? { fixed: { host: '127.0.0.1', port: this.server!.port } }
        : { discovery: this.deps.discovery?.() ?? mdnsDiscovery() }),
      onState: (state: ConnectionState) => {
        // Removed by an administrator: a backup erases its copy of the data at once.
        if (state === 'revoked' && this.config.backup) {
          log.info('this station was removed: erasing its copy of the data');
          this.stopBackup(true);
          this.config = { ...this.config, backup: false };
          this.save();
          this.emit({ type: 'cluster' });
        }
        this.emit({ type: 'connection', state });
      },
      onEvent: (event) => {
        if (event.type === 'cluster-changed') this.emit({ type: 'cluster' });
        this.emit({ type: 'server', event });
      },
      onCluster: (cluster, station) => this.onCluster(cluster, station),
    });
  }

  private startSession(token: string, user: SignedIn, idleMinutes: number) {
    this.endSession(false);
    const idleMs = Math.max(1, idleMinutes) * 60_000;
    this.session = { token, user, idleMs, timer: this.idleTimer(idleMs) };
    log.info(`administrator signed in (signs out after ${idleMinutes} min without activity)`);
    this.emit({ type: 'auth', user });
  }

  /** Inactivity timeout: mirrors the server, so admin pages close even if nothing is clicked. */
  private idleTimer(ms: number) {
    const timer = setTimeout(() => {
      log.info('administrator signed out after inactivity');
      this.endSession();
    }, ms);
    timer.unref?.();
    return timer;
  }

  private touchSession() {
    if (!this.session) return;
    clearTimeout(this.session.timer);
    this.session.timer = this.idleTimer(this.session.idleMs);
  }

  private endSession(notify = true) {
    if (!this.session) return;
    clearTimeout(this.session.timer);
    this.session = null;
    if (notify) this.emit({ type: 'auth', user: null });
  }
}
