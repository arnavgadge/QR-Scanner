/**
 * The server (runs inside the Electron app on the main computer in Server mode).
 *  - HTTPS (TLS 1.2+/1.3, self-signed certificate pinned by stations) on port 47820:
 *      POST /pair/start, /pair/finish   pairing with the 6-digit code (see pairing.ts)
 *      POST /api/<op>                   every data operation (see protocol.ts, api.ts)
 *      GET  /events (WebSocket)          live events (new scans, account changes)
 *      GET  /replicate (WebSocket)       the backup main computer's copy of every change
 *                                        (see cluster.ts)
 *  - Every /api request: app version must match exactly (else "update required"), the station
 *    credential must be valid and not revoked, and the operation's access level is enforced HERE
 *    (station / signed-in / admin / admin on the server computer itself). Scanning needs only the
 *    station; admin sessions slide forward on every use and end after the inactivity timeout.
 *  - Announces itself on the network (discovery.ts). Owns every timestamp.
 *
 * Every request carries the highest term the caller knows (x-term); hearing of a higher one means a
 * backup was made the main computer, and this one retires (cluster.ts).
 *
 * The database is one file: <dataDir>/serials.db (with the certificate next to it).
 */
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { msg } from '../../../web/src/i18n/core';
import { AppError } from '../../../web/src/services/errors';
import {
  OP_ACCESS,
  SERVER_PORT,
  type OpName,
  type ServerEvent,
  type WireError,
  type WireResult,
} from '../../../web/src/desktop/protocol';
import type { User } from '../../../web/src/types';
import { Announcer, lanAddresses } from '../net/discovery';
import { describeError, logger } from '../log';
import {
  adminIdleMinutes,
  createFirstAdmin,
  createHandlers,
  type CallContext,
  type Handlers,
} from './api';
import { loadOrCreateIdentity } from './certificate';
import { Cluster, DEFAULT_HEARTBEAT_MS } from './cluster';
import { PairingManager } from './pairing';
import { hashToken, newId, newToken } from './secrets';
import { SqliteStore, type NodeRecord } from './store';

export interface ServerOptions {
  dataDir: string;
  version: string;
  /** Default 47820; 0 = any free port (tests). */
  port?: number;
  host?: string;
  /** Injectable clock (tests). */
  now?: () => Date;
  /** Announce on the network (mDNS). Default true. */
  announce?: boolean;
  /** This computer's name, announced on the network (default: the OS computer name). */
  computerName?: string;
  /** Liveness timing for the network-split rule (tests use short ones). */
  heartbeatMs?: number;
  leaseMs?: number;
}

export interface RunningServer {
  serverId: string;
  port: number;
  certPem: string;
  fingerprint: string;
  store: SqliteStore;
  pairing: PairingManager;
  cluster: Cluster;
  dbFile: string;
  hasAdmin(): Promise<boolean>;
  createFirstAdmin(input: { name: string; email: string; password: string }): Promise<User>;
  /** Credential for the server computer's own window (replaces any previous one). */
  createServerStation(): Promise<{ nodeId: string; nodeToken: string }>;
  addresses(): string[];
  close(): Promise<void>;
}

const MAX_BODY = 32 * 1024 * 1024;
const log = logger('server');
const STATUS: Partial<Record<WireError['code'], number>> = {
  'invalid-credentials': 401,
  'session-expired': 401,
  revoked: 401,
  'permission-denied': 403,
  'not-found': 404,
  'update-required': 426,
  locked: 423,
  'invalid-data': 400,
};

function isLoopback(address: string | undefined) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function toWireError(e: unknown): WireError {
  if (e instanceof AppError)
    return { code: e.code, message: e.message, ...(e.msg ? { msg: e.msg } : {}) };
  const m = msg('errors.generic');
  return { code: 'unknown', message: new AppError('unknown', m).message, msg: m };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new AppError('invalid-data', msg('errors.generic'));
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('invalid-data', msg('errors.generic'));
  }
}

function send(res: ServerResponse, result: WireResult<unknown>) {
  const status = result.ok ? 200 : (STATUS[result.error.code] ?? 500);
  const body = JSON.stringify(result);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const now = opts.now ?? (() => new Date());
  mkdirSync(opts.dataDir, { recursive: true });
  const dbFile = join(opts.dataDir, 'serials.db');
  const store = new SqliteStore(dbFile);

  let serverId = await store.getMeta('server_id');
  if (!serverId) {
    serverId = newId();
    await store.setMeta('server_id', serverId);
    await store.setMeta('term', '1');
  }
  const identity = await loadOrCreateIdentity(opts.dataDir, serverId);
  log.info(`server ${serverId}, app version ${opts.version}`);
  log.info(`database ${dbFile}`);
  log.info(`TLS certificate ${identity.origin}, SHA-256 ${identity.fingerprint}`);
  if (identity.origin === 'replaced') {
    log.warn(
      'the previous certificate could not be used by stations and was replaced: stations paired before must pair again',
    );
  }

  const sockets = new Map<string, Set<WebSocket>>();
  const broadcast = (event: ServerEvent) => {
    const data = JSON.stringify(event);
    for (const set of sockets.values())
      for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const disconnectNode = (nodeId: string) => {
    for (const ws of sockets.get(nodeId) ?? []) ws.close(4001, 'revoked');
    sockets.delete(nodeId);
  };

  const createStation = async (name: string, appVersion: string, isServer = false) => {
    const nodeId = newId();
    const nodeToken = newToken();
    await store.createNode({
      id: nodeId,
      name,
      tokenHash: hashToken(nodeToken),
      appVersion,
      isServer,
      now: now().toISOString(),
    });
    return { nodeId, nodeToken };
  };

  let onRetired = () => undefined as void;
  const cluster = new Cluster({
    onRetired: () => onRetired(),
    store,
    certPem: identity.certPem,
    now,
    broadcast,
    ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}),
    ...(opts.leaseMs !== undefined ? { leaseMs: opts.leaseMs } : {}),
  });
  log.info(
    `term ${cluster.term()}, ${cluster.role === 'main' ? 'main computer' : 'NO LONGER the main computer (retired)'}${cluster.backupNodeId() ? `, backup ${cluster.backupNodeId()!.slice(0, 8)}` : ', no backup'}`,
  );

  const pairing = new PairingManager({
    now: () => now().getTime(),
    serverId,
    certPem: identity.certPem,
    createStation: (name, appVersion) => createStation(name, appVersion),
  });

  const handlers: Handlers = createHandlers({
    store,
    pairing,
    now,
    broadcast,
    disconnectNode,
    cluster,
    sessionsEnded: (uid) => broadcast({ type: 'user-changed', uid }),
    serverId,
    version: opts.version,
  });

  const lastTouched = new Map<string, number>();

  /** Station credential + app version, shared by /api and /events. */
  async function authenticateStation(req: IncomingMessage): Promise<NodeRecord> {
    if (req.headers['x-app-version'] !== opts.version) {
      throw new AppError(
        'update-required',
        msg('server.updateRequired', { version: opts.version }),
      );
    }
    const token = req.headers['x-node-token'];
    const node =
      typeof token === 'string' && token ? await store.getNodeByTokenHash(hashToken(token)) : null;
    if (!node || node.revoked) throw new AppError('revoked', msg('server.revoked'));
    // The caller knows of a newer main computer: this one was replaced.
    const term = Number(req.headers['x-term']);
    if (term) cluster.seenTerm(term);
    const t = now().getTime();
    if (t - (lastTouched.get(node.id) ?? 0) > 30_000) {
      lastTouched.set(node.id, t);
      await store.touchNode(node.id, opts.version, now().toISOString());
    }
    return node;
  }

  async function handleApi(op: string, req: IncomingMessage) {
    const node = await authenticateStation(req);
    if (!Object.prototype.hasOwnProperty.call(OP_ACCESS, op)) {
      throw new AppError('not-found', msg('errors.notFound'));
    }
    const name = op as OpName;
    const access = OP_ACCESS[name];
    const local = isLoopback(req.socket.remoteAddress);
    const ctx: CallContext = { node, user: null, sessionHash: null, local };
    if (access === 'admin-local' && !(node.isServer && local)) {
      throw new AppError('permission-denied', msg('stations.serverOnly'));
    }
    if (access !== 'station') {
      const session = req.headers['x-session'];
      const sessionHash = typeof session === 'string' && session ? hashToken(session) : null;
      const record = sessionHash ? await store.getSession(sessionHash) : null;
      const expired =
        !record || record.expiresAt <= now().toISOString() || record.nodeId !== node.id;
      const user = record && !expired ? await store.getUserById(record.userId) : null;
      if (!user || !user.active) {
        if (sessionHash) await store.deleteSession(sessionHash);
        throw new AppError('session-expired', msg('auth.sessionExpired'));
      }
      if ((access === 'admin' || access === 'admin-local') && user.role !== 'admin') {
        throw new AppError('permission-denied', msg('auth.noPermission'));
      }
      // Activity keeps an administrator signed in; inactivity ends the session.
      const idle = await adminIdleMinutes(store);
      await store.extendSession(
        sessionHash!,
        new Date(now().getTime() + idle * 60_000).toISOString(),
      );
      ctx.user = user;
      ctx.sessionHash = sessionHash;
    }
    const input = await readJson(req);
    const handler = handlers[name] as (i: unknown, c: CallContext) => Promise<unknown>;
    try {
      return await handler(input, ctx);
    } finally {
      cluster.kick(); // whatever changed goes to the backup now
    }
  }

  const server: Server = createServer(
    { cert: identity.certPem, key: identity.keyPem, minVersion: 'TLSv1.2' },
    (req, res) => {
      void (async () => {
        try {
          if (req.method !== 'POST') throw new AppError('not-found', msg('errors.notFound'));
          const url = new URL(req.url ?? '/', 'https://server');
          if (url.pathname.startsWith('/pair/') && cluster.role !== 'main') {
            throw new AppError('not-main', msg('cluster.notMain'));
          }
          if (url.pathname === '/pair/start') {
            await readJson(req);
            return send(res, { ok: true, data: await pairing.start() });
          }
          if (url.pathname === '/pair/finish') {
            const body = (await readJson(req)) as Parameters<PairingManager['finish']>[0];
            return send(res, { ok: true, data: await pairing.finish(body) });
          }
          if (url.pathname.startsWith('/api/')) {
            const data = await handleApi(decodeURIComponent(url.pathname.slice(5)), req);
            return send(res, { ok: true, data });
          }
          throw new AppError('not-found', msg('errors.notFound'));
        } catch (e) {
          send(res, { ok: false, error: toWireError(e) });
        }
      })();
    },
  );

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      try {
        const path = new URL(req.url ?? '/', 'https://server').pathname;
        if (path !== '/events' && path !== '/replicate') throw new Error('path');
        const node = await authenticateStation(req);
        if (path === '/replicate') {
          // Only the designated backup, and only while this is the main computer.
          if (cluster.role !== 'main' || node.id !== cluster.backupNodeId()) {
            throw new AppError('permission-denied', msg('auth.noPermission'));
          }
          const source = String(req.headers['x-repl-source'] ?? '');
          const seq = Math.max(0, Math.floor(Number(req.headers['x-repl-seq']) || 0));
          wss.handleUpgrade(req, socket, head, (ws) => {
            const alive = () => ((ws as WebSocket & { alive?: boolean }).alive = true);
            alive();
            ws.on('pong', alive);
            // During the first copy the heartbeat ping waits behind all the data on this
            // connection; the backup's progress messages (other direction) prove it is there.
            ws.on('message', alive);
            cluster.attachBackup(ws, node.id, source, seq);
          });
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          cluster.stationConnected(node.id, ws);
          const set = sockets.get(node.id) ?? new Set();
          set.add(ws);
          sockets.set(node.id, set);
          (ws as WebSocket & { alive?: boolean }).alive = true;
          ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
          ws.on('close', () => set.delete(ws));
          ws.on('message', () => undefined); // stations never send events
        });
      } catch (e) {
        const err = toWireError(e);
        socket.end(
          `HTTP/1.1 ${STATUS[err.code] ?? 400} Refused\r\nx-error-code: ${err.code}\r\nconnection: close\r\n\r\n`,
        );
      }
    })();
  });
  // Drop dead connections (station switched off / network gone) so they never pile up. Two
  // heartbeats in a row without an answer: one late answer (e.g. a computer busy for a moment
  // applying a large piece of the backup's first copy) must not cut every connection.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { alive?: boolean; missed?: number };
      w.missed = w.alive === false ? (w.missed ?? 0) + 1 : 0;
      if (w.missed >= 2) {
        w.terminate();
        continue;
      }
      w.alive = false;
      w.ping();
    }
  }, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
  heartbeat.unref();

  const wantedPort = opts.port ?? SERVER_PORT;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(wantedPort, opts.host ?? '0.0.0.0', () => resolve());
    });
  } catch (e) {
    log.error(
      `cannot listen on port ${wantedPort}: ${describeError(e)}${(e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? ' (another copy of the server is already running on this computer?)' : ''}`,
    );
    store.close();
    throw e;
  }
  server.on('tlsClientError', (err, socket) =>
    log.warn(`TLS handshake failed from ${socket.remoteAddress ?? '?'}: ${describeError(err)}`),
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : wantedPort;
  log.info(`listening on ${opts.host ?? '0.0.0.0'}:${port} (HTTPS + live events)`);

  let announcer: Announcer | null =
    opts.announce === false
      ? null
      : new Announcer({
          serverId,
          version: opts.version,
          port,
          instance: identity.fingerprint.replace(/:/g, '').slice(0, 16),
          computerName: opts.computerName ?? hostname(),
        });
  onRetired = () => {
    // A retired main computer is no longer offered to stations (or for pairing).
    announcer?.close();
    announcer = null;
  };
  if (cluster.role === 'retired') onRetired();

  return {
    serverId,
    port,
    certPem: identity.certPem,
    fingerprint: identity.fingerprint,
    store,
    pairing,
    cluster,
    dbFile,
    hasAdmin: async () => (await store.countUsers()) > 0,
    createFirstAdmin: (input) => createFirstAdmin(store, input, now().toISOString()),
    createServerStation: () => createStation('Main computer', opts.version, true),
    addresses: lanAddresses,
    close: async () => {
      clearInterval(heartbeat);
      cluster.close();
      announcer?.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
      store.close();
    },
  };
}
