// Server behaviour: stations scan without signing in (the station is the identity), atomic
// duplicate check, station names/operators, revocation, version check, admin-only sign-in with an
// inactivity timeout, live push, outage + recovery, rediscovery, Excel import.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../web/src/services/errors';
import { OP_ACCESS, type OpName } from '../../web/src/desktop/protocol';
import type { FoundServer } from '../src/net/discovery';
import { ServerLink, type DiscoverySource } from '../src/node/link';
import {
  endpointOf,
  linkTo,
  loginAdmin,
  pairStation,
  register,
  seed,
  setupStation,
  startTestServer,
  VERSION,
  waitFor,
  type TestLink,
  type TestServer,
} from './helpers';

let t: TestServer;
let admin: TestLink; // the server computer's own window (its own station)
let a: TestLink; // station A (usual operator: Ravi)
let b: TestLink; // station B (no usual operator)
let adminSession: string;

beforeEach(async () => {
  t = await startTestServer();
  const serverCreds = await t.server.createServerStation();
  admin = linkTo(t.server, {
    serverId: t.server.serverId,
    nodeId: serverCreds.nodeId,
    nodeToken: serverCreds.nodeToken,
    certPem: t.server.certPem,
  });
  ({ adminSession } = await seed(t.server, admin.link));
  a = linkTo(t.server, await pairStation(t.server, ''));
  b = linkTo(t.server, await pairStation(t.server, ''));
  await setupStation(a.link, 'Station A', 'Ravi');
  await setupStation(b.link, 'Station B');
  await waitFor(
    () => a.link.state === 'online' && b.link.state === 'online',
    5_000,
    'stations online',
  );
});
afterEach(async () => {
  for (const l of [admin, a, b]) l?.link.close();
  await t.cleanup();
});

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
};

describe('stations scan without signing in', () => {
  it('a paired station registers with no sign-in at all', async () => {
    await expect(register(a.link, '13WAA000000001')).resolves.toMatchObject({ result: 'new' });
    await expect(a.link.call('scans.recent', { count: 5 })).resolves.toHaveLength(1);
    await expect(a.link.call('companies.active', {})).resolves.toHaveLength(2);
  });

  it('…including after a restart of the station and of the main computer', async () => {
    const creds = await pairStation(t.server, '');
    const first = linkTo(t.server, creds);
    await setupStation(first.link, 'Station C');
    await expect(register(first.link, '13WAA000000002')).resolves.toMatchObject({ result: 'new' });
    first.link.close();

    // Station app restarted: same saved credential, nothing else.
    const restarted = linkTo(t.server, creds);
    await expect(register(restarted.link, '13WAA000000003')).resolves.toMatchObject({
      result: 'new',
      nodeName: 'Station C',
    });

    // Main computer restarted.
    const port = t.server.port;
    await t.stop();
    await waitFor(() => restarted.link.state === 'offline', 5_000, 'offline');
    await t.restart(port);
    await waitFor(() => restarted.link.state === 'online', 10_000, 'online again');
    await expect(register(restarted.link, '13WAA000000004')).resolves.toMatchObject({
      result: 'new',
    });
    restarted.link.close();
  });

  it('an unpaired station (no or forged credential) cannot register', async () => {
    const forged = new ServerLink({
      credentials: {
        serverId: t.server.serverId,
        nodeId: 'x',
        nodeToken: 'forged-token',
        certPem: t.server.certPem,
      },
      appVersion: VERSION,
      fixed: endpointOf(t.server),
      retryMs: 100,
    });
    expect(await errorCode(register(forged, '13WAA000000005'))).toBe('revoked');
    forged.close();
    expect(await t.server.store.countSerials()).toBe(0);
  });

  it('a removed station cannot register (locked out at once, including its live connection)', async () => {
    const stationB = (await admin.link.call('nodes.list', {}, adminSession)).find(
      (n) => n.name === 'Station B',
    )!;
    await admin.link.call('nodes.revoke', { nodeId: stationB.id }, adminSession);
    await waitFor(() => b.link.state === 'revoked', 5_000, 'B revoked');
    expect(await errorCode(register(b.link, '13WAA000000006'))).toBe('revoked');
    expect(await errorCode(b.link.call('hello', {}))).toBe('revoked');
    expect(await t.server.store.countSerials()).toBe(0);
  });
});

describe('registration', () => {
  it('two stations sending the same serial at the same instant: exactly one new, one duplicate', async () => {
    for (let i = 0; i < 25; i++) {
      const serial = `13WAA${String(100000000 + i)}`;
      const results = await Promise.all([register(a.link, serial), register(b.link, serial)]);
      expect(results.map((r) => r.result).sort(), serial).toEqual(['duplicate', 'new']);
    }
    expect(await t.server.store.countSerials()).toBe(25);
    expect((await t.server.store.recentScans(100)).length).toBe(50); // every attempt is logged
  });

  it('records carry the station, its usual operator (if set) and the server time', async () => {
    const first = await register(a.link, '13waa000000007');
    expect(first).toMatchObject({
      result: 'new',
      serial: '13WAA000000007',
      nodeName: 'Station A',
      scannedByName: 'Ravi',
      scannedAt: '2026-10-10T08:00:00.000Z',
    });
    t.clock.advance(60_000);
    const dup = await register(b.link, '13WAA000000007');
    expect(dup).toMatchObject({
      result: 'duplicate',
      existingRecord: {
        nodeName: 'Station A',
        scannedByName: 'Ravi',
        scannedAt: '2026-10-10T08:00:00.000Z',
      },
      currentAttempt: {
        nodeName: 'Station B',
        scannedByName: '',
        timestamp: '2026-10-10T08:01:00.000Z',
      },
    });
  });

  it('serials are unique per company (the same serial may exist once for each company)', async () => {
    expect((await register(a.link, '13WAA000000008', 'company-a')).result).toBe('new');
    expect((await register(a.link, '13WAA000000008', 'company-b')).result).toBe('new');
    expect((await register(a.link, '13WAA000000008', 'company-b')).result).toBe('duplicate');
  });

  it('applies the same rules as the web app (format, inactive company) and never registers then', async () => {
    expect(await register(a.link, 'NOPE')).toMatchObject({ result: 'invalid', reason: 'format' });
    await admin.link.call(
      'companies.update',
      {
        id: 'company-a',
        input: {
          name: 'Company A',
          codeType: 'barcode',
          serialFormat: '13WAA#########',
          active: false,
        },
      },
      adminSession,
    );
    expect(await register(a.link, '13WAA000000009')).toMatchObject({
      result: 'error',
      code: 'company-unavailable',
    });
    expect(await t.server.store.countSerials()).toBe(0);
  });

  it('new registrations are pushed live to every station', async () => {
    await register(a.link, '13WAA000000010');
    await waitFor(
      () => [a, b, admin].every((l) => l.events.some((e) => e.type === 'scan')),
      5_000,
      'push',
    );
    for (const l of [a, b, admin]) {
      expect(l.events.find((e) => e.type === 'scan')).toMatchObject({
        scan: {
          serial: '13WAA000000010',
          result: 'new',
          nodeName: 'Station A',
          scannedByName: 'Ravi',
        },
      });
    }
  });
});

describe('station setup and names', () => {
  it('a new station is "not set up" until its one-time setup; the setup cannot be repeated', async () => {
    const c = linkTo(t.server, await pairStation(t.server, ''));
    expect((await c.link.call('hello', {})).station).toMatchObject({
      name: 'New station',
      configured: false,
    });
    await expect(setupStation(c.link, '  Station C ', ' Meena ')).resolves.toMatchObject({
      name: 'Station C',
      operatorName: 'Meena',
      configured: true,
    });
    expect(await errorCode(setupStation(c.link, 'Renamed by the station'))).toBe('invalid-data');
    expect(
      await errorCode(
        linkTo(t.server, await pairStation(t.server, '')).link.call('station.setup', {
          name: ' ',
          operatorName: '',
        }),
      ),
    ).toBe('invalid-data');
    c.link.close();
  });

  it('an admin can rename a station and change its operator; old records keep their operator', async () => {
    await register(a.link, '13WAA000000011');
    const stationA = (await admin.link.call('nodes.list', {}, adminSession)).find(
      (n) => n.name === 'Station A',
    )!;
    await admin.link.call(
      'nodes.update',
      { nodeId: stationA.id, name: 'Line 1', operatorName: 'Sita' },
      adminSession,
    );
    await waitFor(
      () => a.events.some((e) => e.type === 'station-changed'),
      5_000,
      'station-changed event',
    );
    expect((await a.link.call('hello', {})).station).toMatchObject({
      name: 'Line 1',
      operatorName: 'Sita',
    });
    expect(await register(a.link, '13WAA000000012')).toMatchObject({
      nodeName: 'Line 1',
      scannedByName: 'Sita',
    });
    const [old] = await t.server.store.findSerials([
      { companyId: 'company-a', serial: '13WAA000000011' },
    ]);
    expect(old).toMatchObject({ nodeName: 'Station A', scannedByName: 'Ravi' }); // history unchanged
    // a station cannot rename itself after setup, and a station cannot call nodes.update
    expect(
      await errorCode(
        a.link.call('nodes.update', { nodeId: stationA.id, name: 'X', operatorName: '' }),
      ),
    ).toBe('session-expired');
  });
});

describe('admin pages need an administrator sign-in', () => {
  it('without a sign-in, every admin operation is refused', async () => {
    const adminOps = (Object.keys(OP_ACCESS) as OpName[]).filter((op) =>
      OP_ACCESS[op].startsWith('admin'),
    );
    expect(adminOps.length).toBeGreaterThan(15);
    for (const op of adminOps) {
      // Pairing operations are refused to any station but the server computer itself, before any
      // sign-in is even considered; every other admin operation asks for an admin sign-in.
      const expected = OP_ACCESS[op] === 'admin-local' ? 'permission-denied' : 'session-expired';
      expect(await errorCode(a.link.call(op, {} as never)), op).toBe(expected);
      expect(await errorCode(a.link.call(op, {} as never, 'forged')), op).toBe(expected);
    }
  });

  it('only administrators can sign in (an operator account cannot)', async () => {
    await admin.link.call(
      'users.create',
      { name: 'Oli', email: 'op@example.test', role: 'operator', password: 'operpass1' },
      adminSession,
    );
    const e = await a.link
      .call('auth.login', { email: 'op@example.test', password: 'operpass1' })
      .catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'permission-denied', msg: { key: 'auth.adminOnly' } });
    const s = await loginAdmin(a.link);
    await expect(a.link.call('users.list', {}, s)).resolves.toHaveLength(2);
  });

  it('pairing codes can only be shown on the server computer itself (not to an admin on a station)', async () => {
    const s = await loginAdmin(a.link);
    expect(await errorCode(a.link.call('pairing.open', {}, s))).toBe('permission-denied');
    await expect(admin.link.call('pairing.open', {}, adminSession)).resolves.toMatchObject({
      open: true,
    });
  });

  it('admin sessions end after 15 minutes without activity; activity keeps them alive', async () => {
    const s = await loginAdmin(a.link);
    t.clock.advance(14 * 60_000);
    await expect(a.link.call('me', {}, s)).resolves.toMatchObject({ role: 'admin' }); // activity
    t.clock.advance(14 * 60_000);
    await expect(a.link.call('me', {}, s)).resolves.toMatchObject({ role: 'admin' });
    t.clock.advance(15 * 60_000 + 1);
    expect(await errorCode(a.link.call('me', {}, s))).toBe('session-expired');
    // a session belongs to the station it was created on
    const s2 = await loginAdmin(a.link);
    expect(await errorCode(b.link.call('me', {}, s2))).toBe('session-expired');
  });

  it('the inactivity timeout is configurable (and validated)', async () => {
    await expect(admin.link.call('settings.get', {}, adminSession)).resolves.toEqual({
      adminIdleMinutes: 15,
    });
    await admin.link.call('settings.set', { adminIdleMinutes: 5 }, adminSession);
    expect(
      await errorCode(admin.link.call('settings.set', { adminIdleMinutes: 0 }, adminSession)),
    ).toBe('invalid-data');
    expect(
      await errorCode(admin.link.call('settings.set', { adminIdleMinutes: 9999 }, adminSession)),
    ).toBe('invalid-data');
    const s = await loginAdmin(a.link);
    t.clock.advance(5 * 60_000 + 1);
    expect(await errorCode(a.link.call('me', {}, s))).toBe('session-expired');
  });

  it('deactivating an administrator ends their sessions at once', async () => {
    await admin.link.call(
      'users.create',
      { name: 'Ben', email: 'ben@example.test', role: 'admin', password: 'benpass12' },
      adminSession,
    );
    const s = (
      await a.link.call('auth.login', { email: 'ben@example.test', password: 'benpass12' })
    ).session;
    const ben = (await admin.link.call('users.list', {}, adminSession)).find(
      (u) => u.email === 'ben@example.test',
    )!;
    await admin.link.call(
      'users.change',
      { uid: ben.uid, change: { active: false } },
      adminSession,
    );
    expect(await errorCode(a.link.call('me', {}, s))).toBe('session-expired');
    expect(
      await errorCode(
        a.link.call('auth.login', { email: 'ben@example.test', password: 'benpass12' }),
      ),
    ).toBe('permission-denied');
  });

  it('wrong passwords are refused without revealing whether the account exists, and are throttled', async () => {
    expect(
      await errorCode(a.link.call('auth.login', { email: 'nobody@example.test', password: 'x' })),
    ).toBe('invalid-credentials');
    for (let i = 0; i < 5; i++)
      await errorCode(
        a.link.call('auth.login', { email: 'admin@example.test', password: 'wrong' }),
      );
    expect(await errorCode(loginAdmin(a.link))).toBe('invalid-credentials'); // even the right one waits
  });

  it('passwords are stored only as scrypt hashes; station and session tokens only as SHA-256', async () => {
    const s = await loginAdmin(a.link);
    const db = (t.server.store as unknown as { db: import('better-sqlite3').Database }).db;
    const users = db.prepare('SELECT password_hash FROM users').all() as {
      password_hash: string;
    }[];
    expect(users.every((u) => u.password_hash.startsWith('scrypt$'))).toBe(true);
    const dump = JSON.stringify([
      db.prepare('SELECT * FROM users').all(),
      db.prepare('SELECT * FROM sessions').all(),
      db.prepare('SELECT * FROM nodes').all(),
    ]);
    expect(dump).not.toContain('adminpass1');
    expect(dump).not.toContain(s);
  });

  it('a station with the wrong app version is rejected (calls and live connection)', async () => {
    const old = linkTo(t.server, await pairStation(t.server, 'Old version'), { version: '0.0.1' });
    await waitFor(() => old.link.state === 'update-required', 5_000, 'update-required');
    expect(await errorCode(register(old.link, '13WAA000000013'))).toBe('update-required');
    old.link.close();
  });
});

describe('outages and address changes', () => {
  it('server down: stations refuse to register (no queue) and recover when it returns', async () => {
    const port = t.server.port;
    await t.stop();
    await waitFor(() => a.link.state === 'offline', 5_000, 'offline');
    expect(await errorCode(register(a.link, '13WAA000000014'))).toBe('server-unreachable');
    await t.restart(port);
    await waitFor(() => a.link.state === 'online', 10_000, 'back online');
    await expect(register(a.link, '13WAA000000014')).resolves.toMatchObject({ result: 'new' });
    expect(await t.server.store.countSerials()).toBe(1); // nothing was queued and replayed
  });

  it('server moved to a new address: the station follows it by server ID, without user action', async () => {
    let announce: ((s: FoundServer) => void) | null = null;
    const discovery: DiscoverySource = {
      start: (cb) => (announce = cb),
      refresh: () => undefined,
      stop: () => undefined,
    };
    const m = linkTo(t.server, await pairStation(t.server, 'Mobile'), { discovery, fixed: false });
    const tell = (port: number, serverId = t.server.serverId) =>
      announce!({ serverId, name: 'srv', version: '', host: '127.0.0.1', port });
    tell(t.server.port);
    await waitFor(() => m.link.state === 'online', 5_000, 'online');
    tell(1, 'someone-else'); // a different server on the network is ignored
    expect(m.link.address?.port).toBe(t.server.port);
    await t.stop();
    await waitFor(() => m.link.state === 'offline', 5_000, 'offline');
    const moved = await t.restart(0);
    tell(moved.port);
    await waitFor(() => m.link.state === 'online', 5_000, 'rediscovered');
    expect(m.link.address?.port).toBe(moved.port);
    m.link.close();
  });
});

describe('excel import', () => {
  it('skips existing serials, lists conflicts, never overwrites', async () => {
    await register(a.link, '13WAA000000020', 'company-a', 'P-1');
    const row = (n: number, serial: string, partNo: string, company = 'Company A') => ({
      rowNumber: n,
      sheet: 'S',
      serial,
      partNo,
      company,
      companyId: '',
      problems: [],
    });
    const preview = await admin.link.call(
      'import.preview',
      {
        filename: 'f.xlsx',
        sheetName: 'S',
        sheets: [{ name: 'S', rows: 4 }],
        rows: [
          row(2, '13WAA000000020', 'P-1'),
          row(3, '13WAA000000020', 'P-2', 'Company B'),
          row(4, '13WAA000000021', 'P-9'),
          row(5, '13WAA000000021', 'P-9'),
        ],
      },
      adminSession,
    );
    expect(preview.rows.map((r) => r.cls)).toEqual(['existing', 'new', 'new', 'duplicate']);
    await register(a.link, '13WAA000000021', 'company-a', 'X'); // registered between preview and import
    const { outcome, historyRecorded } = await admin.link.call(
      'import.confirm',
      { preview },
      adminSession,
    );
    expect(outcome).toMatchObject({ created: 1, raceConflicts: 1, status: 'completed' });
    expect(historyRecorded).toBe(true);
    const [kept] = await t.server.store.findSerials([
      { companyId: 'company-a', serial: '13WAA000000021' },
    ]);
    expect(kept).toMatchObject({ partNo: 'X', source: 'manual' }); // not overwritten
  });
});

describe('find and print any serial', () => {
  const row = (n: number, serial: string, partNo: string, company = 'Company A') => ({
    rowNumber: n,
    sheet: 'S',
    serial,
    partNo,
    company,
    companyId: '',
    problems: [],
  });
  /** Imports rows from "parts.xlsx" as the administrator (on the main computer's own station). */
  async function importRows(rows: ReturnType<typeof row>[]) {
    const preview = await admin.link.call(
      'import.preview',
      {
        filename: 'parts.xlsx',
        sheetName: 'S',
        sheets: [{ name: 'S', rows: rows.length }],
        rows,
      },
      adminSession,
    );
    return { preview, ...(await admin.link.call('import.confirm', { preview }, adminSession)) };
  }

  it('finds serials registered at a station and imported ones (exact or by first characters)', async () => {
    await register(a.link, '13WAA000000101', 'company-a', 'P-1');
    await importRows([row(2, '13WAA000000102', 'P-2')]);

    const exact = await admin.link.call(
      'serials.search',
      { query: '13waa000000101' },
      adminSession,
    );
    expect(exact).toHaveLength(1);
    expect(exact[0]!.record).toMatchObject({
      serial: '13WAA000000101',
      company: 'Company A',
      partNo: 'P-1',
      source: 'manual',
      nodeName: 'Station A',
      scannedByName: 'Ravi',
    });
    expect(exact[0]!.record.scannedAt).toBe(t.clock.now().toISOString());
    expect(exact[0]!.company).toMatchObject({ id: 'company-a', codeType: 'barcode' });

    const prefix = await admin.link.call('serials.search', { query: '13WAA0000001' }, adminSession);
    expect(prefix.map((f) => f.record.serial)).toEqual(['13WAA000000101', '13WAA000000102']);
    expect(prefix[1]!.record).toMatchObject({
      source: 'excel',
      importFile: 'parts.xlsx',
      scannedByName: 'Ada Admin',
    });
    expect(await admin.link.call('serials.search', { query: 'NOPE' }, adminSession)).toEqual([]);
    expect(await admin.link.call('serials.search', { query: '  ' }, adminSession)).toEqual([]);
  });

  it('lists imported serials in Scan History as "Imported", never in the stations\' recent scans', async () => {
    await register(a.link, '13WAA000000110');
    await importRows([row(2, '13WAA000000111', 'P-1'), row(3, '13WAA000000112', 'P-2')]);

    const all = await admin.link.call('scans.history', { filters: {}, after: null }, adminSession);
    expect(all.entries.map((e) => [e.serial, e.kind])).toEqual([
      ['13WAA000000112', 'import'],
      ['13WAA000000111', 'import'],
      ['13WAA000000110', 'scan'],
    ]);
    expect(all.entries[0]).toMatchObject({ source: 'excel', scannedByName: 'Ada Admin' });
    const imported = await admin.link.call(
      'scans.history',
      { filters: { kind: 'import' }, after: null },
      adminSession,
    );
    expect(imported.entries).toHaveLength(2);
    // "New" means new at a station; imports are their own kind.
    const fresh = await admin.link.call(
      'scans.history',
      { filters: { result: 'new' }, after: null },
      adminSession,
    );
    expect(fresh.entries.map((e) => e.serial)).toEqual(['13WAA000000110']);
    const recent = await a.link.call('scans.recent', { count: 10 });
    expect(recent.map((e) => e.serial)).toEqual(['13WAA000000110']);
  });

  it('import details: which serials were added, which were skipped, and the conflicts', async () => {
    await register(a.link, '13WAA000000120', 'company-a', 'P-1');
    await register(a.link, '13WAA000000121', 'company-a', 'P-1');
    const rows = [
      row(2, '13WAA000000120', 'P-1'), // already registered, same details -> skipped
      row(3, '13WAA000000121', 'P-OTHER'), // already registered, different part -> conflict
      row(4, '13WAA000000122', 'P-3'), // added
      row(5, '13WAA000000122', 'P-3'), // repeated in the file
      row(6, '', 'P-4'), // invalid
      row(7, '13WAA000000123', 'P-5'), // registered at a station after the preview
    ];
    const preview = await admin.link.call(
      'import.preview',
      { filename: 'parts.xlsx', sheetName: 'S', sheets: [{ name: 'S', rows: 6 }], rows },
      adminSession,
    );
    await register(b.link, '13WAA000000123', 'company-a', 'P-5');
    const { outcome } = await admin.link.call('import.confirm', { preview }, adminSession);
    expect(outcome).toMatchObject({ created: 1, raceSkipped: 1 });

    const [entry] = await admin.link.call('import.history', { count: 5 }, adminSession);
    const details = await admin.link.call('import.details', { importId: entry!.id }, adminSession);
    expect(details).toMatchObject({ filename: 'parts.xlsx', recorded: true });
    const by = (o: string) =>
      details.items.filter((i) => i.outcome === o).map((i) => [i.rowNumber, i.serial]);
    expect(by('added')).toEqual([[4, '13WAA000000122']]);
    expect(by('skipped')).toEqual([
      [2, '13WAA000000120'],
      [7, '13WAA000000123'],
    ]);
    expect(by('conflict')).toEqual([[3, '13WAA000000121']]);
    expect(by('duplicate')).toEqual([[5, '13WAA000000122']]);
    expect(by('invalid')).toEqual([[6, '']]);
    const race = details.items.find((i) => i.rowNumber === 7)!;
    expect(race.reasonMsg).toEqual({ key: 'importDetails.raceSame' });
    expect(details.items.find((i) => i.rowNumber === 3)!.reason).not.toBe('');

    expect(
      await errorCode(admin.link.call('import.details', { importId: '999' }, adminSession)),
    ).toBe('not-found');
  });

  it('reprint: administrators only, logged in Scan History with the station and time', async () => {
    await register(a.link, '13WAA000000130', 'company-b', 'P-1');
    const input = { companyId: 'company-b', serial: '13WAA000000130' };
    // A station on its own can never print a second label for a registered serial.
    expect(await errorCode(a.link.call('labels.reprint', input))).toBe('session-expired');
    expect(await errorCode(a.link.call('labels.reprint', input, 'forged'))).toBe('session-expired');

    t.clock.advance(60_000);
    const session = await loginAdmin(a.link); // an administrator at station A
    const printed = await a.link.call('labels.reprint', input, session);
    expect(printed.record).toMatchObject({ serial: '13WAA000000130', partNo: 'P-1' });
    // The company's label settings come along, so the label has the normal layout and size.
    expect(printed.company).toMatchObject({
      codeType: 'qr',
      labelSize: { widthMm: 50, heightMm: 25 },
    });

    const log = await admin.link.call(
      'scans.history',
      { filters: { kind: 'reprint' }, after: null },
      adminSession,
    );
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      serial: '13WAA000000130',
      kind: 'reprint',
      nodeName: 'Station A',
      scannedByName: 'Ada Admin',
      timestamp: t.clock.now().toISOString(),
    });
    // A reprint is not a scan: not in the stations' recent scans, not counted as new.
    expect((await a.link.call('scans.recent', { count: 10 })).map((e) => e.kind)).toEqual(['scan']);

    expect(
      await errorCode(
        a.link.call(
          'labels.reprint',
          { companyId: 'company-a', serial: '13WAA000000999' },
          session,
        ),
      ),
    ).toBe('not-found');
  });
});
