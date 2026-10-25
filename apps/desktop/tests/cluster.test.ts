// Backup main computer (server level): the network-split rule, every change copied to the backup,
// and "new" confirmed by the backup before the station shows it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Replica } from '../src/node/replica';
import { REPLICATED_TABLES, SqliteStore } from '../src/server/store';
import {
  linkTo,
  loginAdmin,
  pairStation,
  register,
  seed,
  setupStation,
  startTestServer,
  waitFor,
  type TestLink,
  type TestServer,
} from './helpers';

// Test timing. Every computer runs in this one process, so when the process pauses (plain Node
// was measured pausing up to 1.3 s at random moments, e.g. for garbage collection) every
// heartbeat answer is late at once. The settling time must outlast such a pause plus a heartbeat;
// the app uses 5 s and 15 s (separate computers, not one shared process).
const HEARTBEAT = 500;
const LEASE = 2_500;
let t: TestServer;
let admin: TestLink;
let adminSession: string;
const links: TestLink[] = [];
const replicas: { replica: Replica; store: SqliteStore }[] = [];

beforeEach(async () => {
  t = await startTestServer({ heartbeatMs: HEARTBEAT, leaseMs: LEASE });
  const own = await t.server.createServerStation();
  admin = linkTo(t.server, {
    serverId: t.server.serverId,
    nodeId: own.nodeId,
    nodeToken: own.nodeToken,
    certPem: t.server.certPem,
  });
  ({ adminSession } = await seed(t.server, admin.link));
});
afterEach(async () => {
  for (const r of replicas.splice(0)) {
    r.replica.stop();
    r.store.close();
  }
  for (const l of [admin, ...links.splice(0)]) l.link.close();
  await t.cleanup();
});

async function station(name: string) {
  const l = linkTo(t.server, await pairStation(t.server, ''));
  links.push(l);
  await setupStation(l.link, name);
  await waitFor(() => l.link.state === 'online', 5_000, `${name} online`);
  const { station: me } = await l.link.call('hello', {});
  return { ...l, nodeId: me.nodeId };
}

/** The backup station's copy of the data (what the backup computer runs). */
function startReplica(l: TestLink, delayMs = 0) {
  const store = new SqliteStore(':memory:');
  const replica = new Replica({ store, link: l.link, retryMs: 50, delayMs });
  replicas.push({ replica, store });
  return { replica, store };
}

const makeBackup = (nodeId: string) =>
  admin.link.call('cluster.setBackup', { nodeId }, adminSession);
const status = () => admin.link.call('cluster.status', {}, adminSession);
/** Every connection counts only after LEASE (see cluster.ts). */
const settle = () => new Promise((r) => setTimeout(r, LEASE + 150));

describe('network-split rule', () => {
  it('no backup: registering always works (nothing could have been promoted)', async () => {
    const a = await station('A');
    expect(await register(a.link, '13WAA000000001')).toMatchObject({ result: 'new' });
  });

  it('backup offline, no other stations: the backup is required, so registering pauses', async () => {
    const b = await station('Backup');
    await makeBackup(b.nodeId);
    await settle();
    const r = await register(admin.link, '13WAA000000002');
    expect(r).toMatchObject({ result: 'error', code: 'paused' });
    expect((r as { message: string }).message).toBe(
      "Can't reach the other computers. Scanning is paused so no serial is registered twice.",
    );
    expect(await status()).toMatchObject({ registerState: 'paused', otherStations: 0 });

    // The backup connects (and has been connected long enough): registering works again.
    startReplica(b);
    await waitFor(() => replicas[0]!.replica.status().connected, 5_000, 'backup copying');
    await settle();
    expect(await register(admin.link, '13WAA000000002')).toMatchObject({ result: 'new' });
  });

  it('backup connected, other stations switched off: registering works (the backup alone is enough)', async () => {
    // The setup from the field: Station 1 and 2 paired but off, Station 3 the backup.
    const s1 = await station('Station 1');
    const s2 = await station('Station 2');
    const b = await station('Station 3');
    s1.link.close();
    s2.link.close();
    await makeBackup(b.nodeId);
    startReplica(b);
    await waitFor(() => replicas[0]!.replica.status().connected, 5_000, 'backup copying');
    // Just connected: a few seconds' wait, said as such (not "paused").
    expect(await status()).toMatchObject({
      registerState: 'waiting',
      connectedStations: 0,
      otherStations: 2,
      backup: { connected: true },
    });
    const early = await register(admin.link, '13WAA000000060');
    expect(early).toMatchObject({ result: 'error', code: 'paused' });
    expect((early as { message: string }).message).toBe(
      'Connecting to the other computers. Scanning starts in a few seconds.',
    );
    await settle();
    expect(await status()).toMatchObject({ registerState: 'ok', connectedStations: 0 });
    expect(await register(admin.link, '13WAA000000060')).toMatchObject({ result: 'new' });
  });

  it("the backup's copy channel follows its link to another main computer", async () => {
    const b = await station('Backup');
    await makeBackup(b.nodeId);
    // A link that can be told it now follows a newer term (as after a promotion elsewhere).
    let term = 1;
    const link = {
      connection: () => b.link.connection(),
      get term() {
        return term;
      },
    } as unknown as typeof b.link;
    const store = new SqliteStore(':memory:');
    const states: boolean[] = [];
    const replica = new Replica({
      store,
      link,
      retryMs: 50,
      onStatus: (st) => states.push(st.connected),
    });
    replicas.push({ replica, store });
    await waitFor(() => replica.status().connected, 5_000, 'backup copying');
    await waitFor(() => t.server.cluster.backupNodeId() === b.nodeId && states.length > 0, 5_000);
    term = 2;
    // The old channel is closed at once (the old main computer stops counting it)...
    await waitFor(() => states.includes(false), 2_000, 'old channel closed');
    // ...and a new one is opened through the link's current main computer.
    await waitFor(() => replica.status().connected, 5_000, 'reconnected');
  });

  it('backup offline: more than half of the other stations must be connected', async () => {
    const b = await station('Backup');
    const s1 = await station('S1');
    const s2 = await station('S2');
    const s3 = await station('S3');
    await makeBackup(b.nodeId);
    await settle();
    // 3 of 3 other stations connected
    expect(await register(s1.link, '13WAA000000003')).toMatchObject({ result: 'new' });
    s3.link.close();
    await settle();
    // 2 of 3: still more than half
    expect(await status()).toMatchObject({ connectedStations: 2, otherStations: 3 });
    expect(await register(s1.link, '13WAA000000004')).toMatchObject({ result: 'new' });
    s2.link.close();
    await settle();
    // 1 of 3: paused, for every station and for the main computer's own window
    expect(await register(s1.link, '13WAA000000005')).toMatchObject({ code: 'paused' });
    expect(await register(admin.link, '13WAA000000005')).toMatchObject({ code: 'paused' });
    // Nothing was registered while paused.
    expect(
      await t.server.store.findSerials([{ companyId: 'company-a', serial: '13WAA000000005' }]),
    ).toEqual([]);
    // Excel imports pause too.
    const preview = await admin.link.call(
      'import.preview',
      {
        filename: 'f.xlsx',
        sheetName: 'S',
        sheets: [{ name: 'S', rows: 1 }],
        rows: [
          {
            rowNumber: 2,
            sheet: 'S',
            serial: '13WAA000000006',
            partNo: '',
            company: 'Company A',
            companyId: '',
            problems: [],
          },
        ],
      },
      adminSession,
    );
    await expect(
      admin.link.call('import.confirm', { preview }, adminSession),
    ).rejects.toMatchObject({ code: 'paused' });
  });

  it('a new connection counts only after it has lasted a while (a station may still count for an older main computer)', async () => {
    const b = await station('Backup');
    await makeBackup(b.nodeId);
    startReplica(b);
    await waitFor(() => replicas[0]!.replica.status().connected, 5_000, 'backup copying');
    // Connected just now: not yet.
    expect(await register(admin.link, '13WAA000000007')).toMatchObject({ code: 'paused' });
    await settle();
    expect(await register(admin.link, '13WAA000000007')).toMatchObject({ result: 'new' });
  });
});

/** Puts `count` serials (with their history rows) on the main computer, as an import would. */
async function fill(count: number) {
  const rows = Array.from({ length: count }, (_, i) => ({
    serial: `13WAA${String(i).padStart(9, '0')}`,
    partNo: `P-${i % 7}`,
    companyId: i % 2 ? 'company-a' : 'company-b',
    companyName: i % 2 ? 'Company A' : 'Company B',
  }));
  const store = t.server.store;
  const importId = await store.startImport({
    filename: 'existing.xlsx',
    by: { uid: 'u', name: 'Ada Admin' },
    at: '2026-10-10T08:00:00.000Z',
  });
  await store.importSerials(
    rows,
    { uid: 'u', name: 'Ada Admin' },
    { id: 'n', name: 'Main desk' },
    '2026-10-10T08:00:00.000Z',
    importId,
  );
}

/** Every copied table, row by row (with row numbers), as SQLite has it. */
function dump(store: SqliteStore) {
  return Object.fromEntries(
    REPLICATED_TABLES.map((tbl) => [
      tbl,
      store.db.prepare(`SELECT rowid AS __rowid, * FROM ${tbl} ORDER BY rowid`).all(),
    ]),
  );
}

describe('a new backup: the first full copy', () => {
  it('copies a main computer that already has data, shows progress, and matches it exactly', async () => {
    await fill(6_000); // 6 000 serials + 6 000 history rows: the copy comes in several pieces
    const b = await station('Backup');
    await makeBackup(b.nodeId);
    const store = new SqliteStore(':memory:');
    const progress: (number | null)[] = [];
    const replica = new Replica({
      store,
      link: b.link,
      retryMs: 50,
      onStatus: (st) => progress.push(st.copyProgress),
    });
    replicas.push({ replica, store });
    await waitFor(() => replica.caughtUp() && replica.status().everComplete, 20_000, 'full copy');

    // Progress went up in steps while the copy arrived, then ended.
    const steps = progress.filter((p): p is number => p !== null);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps.some((p) => p > 0 && p < 100)).toBe(true);
    expect(steps).toEqual([...steps].sort((x, y) => x - y));
    expect(replica.status().copyProgress).toBeNull();

    // Exactly the main computer's data: every copied table, every row, every column.
    expect(dump(store)).toEqual(dump(t.server.store));
    expect(await store.countSerials()).toBe(6_000);

    // The main computer reports it as up to date.
    const st = await status();
    expect(st.backup).toMatchObject({ connected: true, upToDate: true, copyProgress: null });
    expect(st.backup?.lastCopiedAt).not.toBeNull();
    // The copy came from this main computer (its own history of changes).
    expect(store.getLocalSync('repl_source')).toContain(t.server.fingerprint);
  });

  it('a backup moved to another station gets its copy from the main computer, not the old backup', async () => {
    await fill(500);
    const first = await station('Backup 1');
    const second = await station('Backup 2');
    await makeBackup(first.nodeId);
    const one = startReplica(first);
    await waitFor(() => one.replica.caughtUp(), 10_000, 'first backup copy');
    await makeBackup(second.nodeId);
    // The old backup is cut off at once (it erases its copy in the app).
    await waitFor(() => !one.replica.status().connected, 5_000, 'old backup cut off');
    one.replica.stop();
    const two = startReplica(second);
    await waitFor(() => two.replica.caughtUp() && two.replica.status().everComplete, 10_000);
    expect(dump(two.store)).toEqual(dump(t.server.store));
    expect(two.store.getLocalSync('repl_source')).toContain(t.server.fingerprint);
  });

  it('the main computer stops during the first copy: the backup keeps what arrived, marked incomplete', async () => {
    await fill(6_000);
    const b = await station('Backup');
    await makeBackup(b.nodeId);
    // A slow network: each piece arrives 150 ms late.
    const { replica, store } = startReplica(b, 150);
    await waitFor(() => (replica.status().copyProgress ?? 0) > 0, 10_000, 'first copy under way');
    await t.stop(); // the main computer stops half way
    await waitFor(() => !replica.status().connected, 5_000, 'disconnected');
    await new Promise((r) => setTimeout(r, 400));
    expect(replica.status().everComplete).toBe(false);
    // Users and settings come first, so an administrator can still promote this backup.
    expect((await store.getUserByEmail('admin@example.test'))?.role).toBe('admin');
    expect(await store.countSerials()).toBeLessThan(6_000);
  });
});

describe('copying to the backup', () => {
  it('serials, scans, imports, companies, users and stations are on the backup', async () => {
    const b = await station('Backup');
    const s = await station('S1');
    await makeBackup(b.nodeId);
    const { replica, store } = startReplica(b);
    await waitFor(() => replica.status().connected, 5_000, 'backup copying');
    await settle();
    await register(s.link, '13WAA000000010', 'company-a', 'P-1');
    await register(s.link, '13WAA000000010', 'company-a', 'P-1'); // duplicate attempt
    const preview = await admin.link.call(
      'import.preview',
      {
        filename: 'parts.xlsx',
        sheetName: 'S',
        sheets: [{ name: 'S', rows: 1 }],
        rows: [
          {
            rowNumber: 2,
            sheet: 'S',
            serial: '13WAA000000011',
            partNo: 'P-2',
            company: 'Company B',
            companyId: '',
            problems: [],
          },
        ],
      },
      adminSession,
    );
    await admin.link.call('import.confirm', { preview }, adminSession);
    await admin.link.call('settings.set', { adminIdleMinutes: 30 }, adminSession);
    await waitFor(() => replica.caughtUp(), 5_000, 'backup caught up');

    const serials = await store.searchSerials('13WAA', 10);
    expect(serials.map((x) => [x.serial, x.partNo, x.importFile ?? null])).toEqual([
      ['13WAA000000010', 'P-1', null],
      ['13WAA000000011', 'P-2', 'parts.xlsx'],
    ]);
    const history = await store.scanHistory({}, null, 10);
    expect(history.entries.map((e) => [e.serial, e.result, e.kind])).toEqual([
      ['13WAA000000011', 'new', 'import'],
      ['13WAA000000010', 'duplicate', 'scan'],
      ['13WAA000000010', 'new', 'scan'],
    ]);
    expect((await store.importHistory(5))[0]).toMatchObject({
      filename: 'parts.xlsx',
      newCount: 1,
    });
    expect((await store.listCompanies(false)).map((c) => c.id).sort()).toEqual([
      'company-a',
      'company-b',
    ]);
    expect((await store.getUserByEmail('admin@example.test'))?.role).toBe('admin');
    expect((await store.listNodes()).map((n) => n.name)).toEqual(
      expect.arrayContaining(['Backup', 'S1']),
    );
    expect(await store.getMeta('admin_idle_minutes')).toBe('30');
    expect(await store.getMeta('server_id')).toBe(t.server.serverId);
    // Sessions are never copied (administrators sign in again after a promotion).
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect((await status()).backup).toMatchObject({ connected: true, name: 'Backup' });
    expect((await status()).backup?.lastCopiedAt).not.toBeNull();
  });

  it('"new" is shown only after the backup has it: nothing lost if the main computer stops right after', async () => {
    const b = await station('Backup');
    const s = await station('S1');
    await makeBackup(b.nodeId);
    // A slow network to the backup: each change arrives 300 ms late.
    const { replica, store } = startReplica(b, 300);
    // The first copy (several slow pieces) must be in before the 2 s wait can cover a change.
    await waitFor(() => replica.caughtUp(), 10_000, 'backup has the first copy');
    await settle();
    for (let i = 0; i < 5; i++) {
      const serial = `13WAA00000002${i}`;
      expect(await register(s.link, serial)).toMatchObject({ result: 'new' });
      // Checked at once, before anything else can happen: the backup already has it.
      expect(await store.findSerials([{ companyId: 'company-a', serial }]), serial).toHaveLength(1);
    }
    await t.stop(); // the main computer stops right after the last "new"
    expect(await store.searchSerials('13WAA00000002', 10)).toHaveLength(5);
  });

  it('backup offline: registering continues (with enough stations) and the admin sees it is not copied', async () => {
    const b = await station('Backup');
    const s1 = await station('S1');
    await station('S2');
    await makeBackup(b.nodeId);
    await settle();
    expect(await register(s1.link, '13WAA000000030')).toMatchObject({ result: 'new' });
    expect((await status()).backup).toMatchObject({ connected: false, lastCopiedAt: null });
  });

  it('a backup that comes back gets only what it missed', async () => {
    const b = await station('Backup');
    const s1 = await station('S1');
    await station('S2');
    await makeBackup(b.nodeId);
    const first = startReplica(b);
    await waitFor(() => first.replica.caughtUp(), 5_000, 'first copy');
    await settle();
    first.replica.stop(); // backup switched off
    await register(s1.link, '13WAA000000040');
    const again = new Replica({ store: first.store, link: b.link, retryMs: 50 });
    replicas.push({ replica: again, store: first.store });
    await waitFor(() => again.caughtUp(), 5_000, 'caught up again');
    expect(
      await first.store.findSerials([{ companyId: 'company-a', serial: '13WAA000000040' }]),
    ).toHaveLength(1);
  });

  it('only the designated backup may receive the data or step the main computer down', async () => {
    const b = await station('Backup');
    const s = await station('S1');
    await makeBackup(b.nodeId);
    const intruder = startReplica(s); // a station that is not the backup
    await new Promise((r) => setTimeout(r, 300));
    expect(intruder.replica.status().connected).toBe(false);
    expect(await intruder.store.countUsers()).toBe(0);
    await expect(s.link.call('cluster.stepDown', { term: 2 })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(
      s.link.call('cluster.registerBackup', { certPem: t.server.certPem }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await status()).role).toBe('main');
  });

  it('a station that knows a newer term makes a former main computer refuse to register', async () => {
    const s = await station('S1');
    const told = linkTo(t.server, {
      serverId: t.server.serverId,
      nodeId: s.nodeId,
      nodeToken: (s.link as unknown as { opts: { credentials: { nodeToken: string } } }).opts
        .credentials.nodeToken,
      certPem: t.server.certPem,
      term: 5,
    });
    links.push(told);
    await waitFor(() => t.server.cluster.role === 'retired', 5_000, 'retired');
    expect(await register(admin.link, '13WAA000000050')).toMatchObject({
      result: 'error',
      code: 'not-main',
      message: 'This computer is no longer the main computer.',
    });
    expect(await loginAdmin(admin.link)).toBeTruthy(); // admin pages still open (hand-over)
  });
});
