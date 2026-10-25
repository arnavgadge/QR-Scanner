import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionState } from '../../web/src/data/DataService';
import type { ServerEvent } from '../../web/src/desktop/protocol';
import { ServerLink, type DiscoverySource, type StationCredentials } from '../src/node/link';
import { httpsPairTransport, pairWithServer, type PairTransport } from '../src/node/pairingClient';
import { startServer, type RunningServer } from '../src/server/server';

export const VERSION = '1.0.0-test';

/** A controllable clock shared by a test server. */
export function testClock(start = Date.parse('2026-10-10T08:00:00.000Z')) {
  let t = start;
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export interface TestServer {
  server: RunningServer;
  dir: string;
  clock: ReturnType<typeof testClock>;
  restart(port?: number): Promise<RunningServer>;
  stop(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function startTestServer(
  opts: { port?: number; dir?: string; heartbeatMs?: number; leaseMs?: number } = {},
): Promise<TestServer> {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'vicimus-server-'));
  const clock = testClock();
  const start = (port = opts.port ?? 0) =>
    startServer({
      dataDir: dir,
      version: VERSION,
      port,
      host: '127.0.0.1',
      now: clock.now,
      announce: false,
      ...(opts.heartbeatMs ? { heartbeatMs: opts.heartbeatMs } : {}),
      ...(opts.leaseMs ? { leaseMs: opts.leaseMs } : {}),
    });
  const t: TestServer = {
    server: await start(),
    dir,
    clock,
    async restart(port?: number) {
      t.server = await start(port ?? t.server.port);
      return t.server;
    },
    async stop() {
      await t.server.close();
    },
    async cleanup() {
      await t.server.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return t;
}

export const endpointOf = (s: RunningServer) => ({ host: '127.0.0.1', port: s.port });

/** Pairs a station with whatever code the server shows now. */
export async function pairStation(
  s: RunningServer,
  name: string,
  opts: { transport?: PairTransport; code?: string; version?: string } = {},
): Promise<StationCredentials> {
  if (!s.pairing.status().open) s.pairing.open();
  const code = opts.code ?? s.pairing.status().code;
  const secret = await pairWithServer({
    transport: opts.transport ?? httpsPairTransport(endpointOf(s)),
    code,
    nodeName: name,
    appVersion: opts.version ?? VERSION,
  });
  return secret;
}

export interface TestLink {
  link: ServerLink;
  states: ConnectionState[];
  events: ServerEvent[];
}

export function linkTo(
  s: RunningServer,
  credentials: StationCredentials,
  opts: { version?: string; discovery?: DiscoverySource; fixed?: boolean } = {},
): TestLink {
  const states: ConnectionState[] = [];
  const events: ServerEvent[] = [];
  const link = new ServerLink({
    credentials,
    appVersion: opts.version ?? VERSION,
    ...(opts.fixed === false ? {} : { fixed: endpointOf(s) }),
    ...(opts.discovery ? { discovery: opts.discovery } : {}),
    onState: (st) => states.push(st),
    onEvent: (e) => events.push(e),
    retryMs: 100,
  });
  return { link, states, events };
}

export async function waitFor(check: () => boolean, ms = 5_000, what = 'condition') {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** First admin (signed in on `admin`) plus two companies (A: barcode, B: qr with its own label size). */
export async function seed(s: RunningServer, admin: ServerLink) {
  await s.createFirstAdmin({
    name: 'Ada Admin',
    email: 'admin@example.test',
    password: 'adminpass1',
  });
  const adminSession = await loginAdmin(admin);
  await admin.call(
    'companies.create',
    {
      input: {
        name: 'Company A',
        codeType: 'barcode',
        serialFormat: '13WAA#########',
        active: true,
      },
    },
    adminSession,
  );
  await admin.call(
    'companies.create',
    {
      input: {
        name: 'Company B',
        codeType: 'qr',
        serialFormat: '13WAA#########',
        active: true,
        labelWidthMm: '50',
        labelHeightMm: '25',
      },
    },
    adminSession,
  );
  return { adminSession };
}

export async function loginAdmin(link: ServerLink) {
  return (await link.call('auth.login', { email: 'admin@example.test', password: 'adminpass1' }))
    .session;
}

/** The one-time station setup (name, usual operator) done by the station itself. */
export function setupStation(link: ServerLink, name: string, operatorName = '') {
  return link.call('station.setup', { name, operatorName });
}

/** A registration as a station: no person, no session. */
export function register(
  link: ServerLink,
  serial: string,
  companyId = 'company-a',
  partNo?: string,
) {
  return link.call('serials.register', {
    serial,
    companyId,
    source: 'manual',
    ...(partNo ? { partNo } : {}),
  });
}
