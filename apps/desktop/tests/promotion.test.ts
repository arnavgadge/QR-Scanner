// Backup main computer and promotion with the real app runtime of each computer (main computer,
// backup, stations) on a fake network: promotion with the admin password or the recovery code,
// stations switching on their own, the former main computer refusing to register, handing over
// what the new main computer is missing, and changing the backup.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DesktopEvent } from '../../web/src/desktop/bridge';
import type { FoundServer } from '../src/net/discovery';
import { EMPTY_CONFIG, type RuntimeDeps, type StoredConfig } from '../src/main/configModel';
import { Runtime } from '../src/main/runtime';
import { serverChoice } from '../../web/src/desktop/setup/serverChoice';
import { SqliteStore } from '../src/server/store';
import type { DiscoverySource } from '../src/node/link';
import { waitFor } from './helpers';

const VERSION = '1.0.0-test';
const ADMIN = { name: 'Ada Admin', email: 'admin@example.test', password: 'adminpass1' };
// Long enough to outlast a pause of the shared test process (see cluster.test.ts).
const HEARTBEAT = 500;
const LEASE = 2_500;

/** Servers "on the network": what mDNS would announce, for every runtime in this test. */
class FakeNetwork {
  readonly servers = new Map<string, FoundServer>();
  private readonly listeners = new Set<(s: FoundServer) => void>();
  private readonly lostListeners = new Set<(s: FoundServer) => void>();
  announce = (info: {
    serverId: string;
    port: number;
    instance: string;
    computerName?: string;
  }) => {
    const found: FoundServer = {
      serverId: info.serverId,
      instance: info.instance,
      ...(info.computerName ? { label: info.computerName } : {}),
      name: '',
      version: VERSION,
      host: '127.0.0.1',
      port: info.port,
    };
    this.servers.set(info.instance, found);
    for (const l of this.listeners) l(found);
    return () => {
      this.servers.delete(info.instance);
      for (const l of this.lostListeners) l(found);
    };
  };
  discovery = (): DiscoverySource => {
    let mine: ((s: FoundServer) => void) | null = null;
    let lost: ((s: FoundServer) => void) | null = null;
    return {
      start: (onFound, onLost) => {
        mine = onFound;
        lost = onLost ?? null;
        this.listeners.add(onFound);
        if (onLost) this.lostListeners.add(onLost);
        for (const s of this.servers.values()) onFound(s);
      },
      refresh: () => {
        for (const s of this.servers.values()) mine?.(s);
      },
      stop: () => {
        if (mine) this.listeners.delete(mine);
        if (lost) this.lostListeners.delete(lost);
      },
    };
  };
}

interface Computer {
  name: string;
  rt: Runtime;
  events: DesktopEvent[];
  dir: string;
  saved: { config: StoredConfig };
  restart(): Promise<Computer>;
}

let root: string;
let net: FakeNetwork;
const running = new Set<Runtime>();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vicimus-promotion-'));
  net = new FakeNetwork();
});
afterEach(async () => {
  for (const rt of running) await rt.stop();
  running.clear();
  rmSync(root, { recursive: true, force: true });
});

function computer(
  name: string,
  saved = { config: { ...EMPTY_CONFIG } as StoredConfig },
  network: FakeNetwork = net,
) {
  const dir = join(root, name);
  const deps: RuntimeDeps = {
    loadConfig: () => structuredClone(saved.config),
    saveConfig: (c) => (saved.config = structuredClone(c)),
    serverDataDir: join(dir, 'server'),
    serverPort: 0,
    protect: (t) => `test:${t}`,
    reveal: (s) => s.replace(/^test:/, ''),
    discovery: network.discovery,
    announce: network.announce,
    computerName: name,
    searchMs: 200,
    serverTiming: { heartbeatMs: HEARTBEAT, leaseMs: LEASE },
  };
  const events: DesktopEvent[] = [];
  const rt = new Runtime(VERSION, (e) => events.push(e), deps);
  running.add(rt);
  const c: Computer = {
    name,
    rt,
    events,
    dir,
    saved,
    async restart() {
      await rt.stop();
      running.delete(rt);
      const again = computer(name, saved, network);
      await again.rt.start();
      return again;
    },
  };
  return c;
}

const ok = <T>(r: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r.data;
};
const settle = () => new Promise((r) => setTimeout(r, LEASE + 200));
const online = (c: Computer) => c.rt.info().connection === 'online';

async function signIn(c: Computer, password = ADMIN.password) {
  ok(await c.rt.call('auth.login', { email: ADMIN.email, password }));
}

async function setUpMain(name = 'main', network: FakeNetwork = net) {
  const main = computer(name, undefined, network);
  const { recoveryCode } = ok(await main.rt.setupServer(ADMIN));
  await waitFor(() => online(main), 10_000, 'main online');
  ok(await main.rt.call('station.setup', { name: 'Main desk', operatorName: '' }));
  await signIn(main);
  ok(
    await main.rt.call('companies.create', {
      input: {
        name: 'Company A',
        codeType: 'barcode',
        serialFormat: '13WAA#########',
        active: true,
      },
    }),
  );
  return { main, recoveryCode };
}

async function addStation(main: Computer, name: string) {
  const c = computer(name);
  const server = main.rt.runningServer!;
  const code = server.pairing.status().open
    ? server.pairing.status().code
    : server.pairing.open().code;
  ok(
    await c.rt.pairStation({
      server: {
        serverId: server.serverId,
        label: '',
        name: '',
        host: '127.0.0.1',
        port: server.port,
      },
      code,
    }),
  );
  await waitFor(() => online(c), 10_000, `${name} online`);
  ok(await c.rt.call('station.setup', { name, operatorName: '' }));
  const hello = ok(await c.rt.call('hello', {}));
  return { c, nodeId: hello.station.nodeId };
}

async function makeBackup(main: Computer, nodeId: string, backup: Computer) {
  ok(await main.rt.call('cluster.setBackup', { nodeId }));
  await waitFor(() => backup.rt.info().role === 'backup', 10_000, 'backup role');
  await waitFor(() => backup.rt.info().backupCopy?.complete === true, 10_000, 'backup copy');
  // Stations learn the backup's certificate from the main computer.
  await waitFor(
    () => main.rt.runningServer!.cluster.info().backup?.certPem !== null,
    10_000,
    'backup certificate shared',
  );
}

const register = (c: Computer, serial: string, partNo = '') =>
  c.rt.call('serials.register', {
    serial,
    companyId: 'company-a',
    source: 'manual',
    ...(partNo ? { partNo } : {}),
  });
const result = async (c: Computer, serial: string, partNo = '') => {
  const r = await register(c, serial, partNo);
  return r.ok ? r.data : { result: 'failed', code: r.error.code };
};

describe('promotion', () => {
  it('planned switch: admin password, stations follow, the old main computer refuses, a new backup is asked for', async () => {
    const { main } = await setUpMain();
    const b = await addStation(main, 'Backup');
    const s = await addStation(main, 'S1');
    await makeBackup(main, b.nodeId, b.c);
    await settle();
    expect(await result(s.c, '13WAA000000001')).toMatchObject({ result: 'new' });
    // The station knows the backup in advance.
    await waitFor(
      () => (s.c.saved.config.station?.knownCerts ?? []).length > 0,
      5_000,
      'station knows the backup',
    );

    // Wrong password: refused, nothing changes.
    expect(
      await b.c.rt.promote({ email: ADMIN.email, password: 'wrong-pass', understood: true }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-credentials' } });
    expect(b.c.rt.info().role).toBe('backup');
    expect(main.rt.runningServer!.cluster.role).toBe('main');

    // Right password; the main computer is reachable, so no "recent serials may be missing" tick.
    expect(
      await b.c.rt.promote({ email: ADMIN.email, password: ADMIN.password, understood: false }),
    ).toEqual({ ok: true, data: { recoveryCode: null } });
    expect(b.c.rt.info()).toMatchObject({ mode: 'server', role: 'main', term: 2 });
    expect(main.rt.info().role).toBe('retired');

    // The station switches on its own (no pairing) and registers on the new main computer.
    await waitFor(() => s.c.rt.info().term === 2 && online(s.c), 10_000, 'station switched');
    await settle();
    expect(await result(s.c, '13WAA000000002')).toMatchObject({ result: 'new' });
    // The serial registered before the switch is there (copied), so it is a duplicate now.
    expect(await result(s.c, '13WAA000000001')).toMatchObject({ result: 'duplicate' });

    // The former main computer never registers again.
    expect(await result(main, '13WAA000000003')).toMatchObject({
      result: 'error',
      code: 'not-main',
    });
    // The new main computer asks for a new backup.
    await signIn(b.c);
    const status = ok(await b.c.rt.call('cluster.status', {}));
    expect(status).toMatchObject({ term: 2, role: 'main', needsBackup: true, backup: null });
    // A promoted backup is the same system: no "another main computer" warning on either.
    await new Promise((r) => setTimeout(r, 300));
    expect(ok(await b.c.rt.call('cluster.status', {})).otherSystems).toEqual([]);
    expect(ok(await main.rt.call('cluster.status', {})).otherSystems).toEqual([]);
  });

  it('main computer gone: needs the tick; recovery code works on the backup; wrong code refused', async () => {
    const { main, recoveryCode } = await setUpMain();
    const b = await addStation(main, 'Backup');
    const s = await addStation(main, 'S1');
    await makeBackup(main, b.nodeId, b.c);
    await settle();
    expect(await result(s.c, '13WAA000000010')).toMatchObject({ result: 'new' });
    await main.rt.stop(); // the main computer breaks down
    running.delete(main.rt);
    await waitFor(() => !online(b.c), 10_000, 'backup notices');

    const info = b.c.rt.info();
    expect(info.backupCopy?.lastCopiedAt).not.toBeNull(); // "Last copied at …"
    expect(
      await b.c.rt.promote({
        email: ADMIN.email,
        recoveryCode: 'AAAA-BBBB-CCCC-DDDD-EEEE',
        newPassword: 'newpass123',
        understood: true,
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid-credentials' } });
    // Not ticked: refused (recent serials may be missing).
    expect(
      await b.c.rt.promote({
        email: ADMIN.email,
        recoveryCode,
        newPassword: 'newpass123',
        understood: false,
      }),
    ).toMatchObject({ ok: false, error: { msg: { key: 'promote.mustConfirm' } } });
    // Ticked, with the recovery code (forgotten password): promoted, new password, new code.
    const done = ok(
      await b.c.rt.promote({
        email: ADMIN.email,
        recoveryCode: recoveryCode.toLowerCase().replace(/-/g, ' '),
        newPassword: 'newpass123',
        understood: true,
      }),
    );
    expect(done.recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    expect(done.recoveryCode).not.toBe(recoveryCode);
    await signIn(b.c, 'newpass123');

    await waitFor(() => s.c.rt.info().term === 2 && online(s.c), 10_000, 'station switched');
    await settle(); // a just-promoted main computer waits a moment before registering
    expect(await result(s.c, '13WAA000000010')).toMatchObject({ result: 'duplicate' });
  });
});

describe('a backup that never received a complete copy', () => {
  it('promotion warns that most data may be missing and needs the tick, even with the main computer reachable', async () => {
    const { main } = await setUpMain();
    const b = await addStation(main, 'Backup');
    await makeBackup(main, b.nodeId, b.c);
    // As if the main computer had stopped during the first copy (the copy marks itself complete
    // only when the last piece is in).
    const copy = new SqliteStore(join(b.c.dir, 'server', 'serials.db'));
    copy.setLocalSync('repl_complete', '0');
    copy.close();
    await waitFor(() => b.c.rt.info().backupCopy?.everComplete === false, 5_000, 'incomplete');

    expect(
      await b.c.rt.promote({ email: ADMIN.email, password: ADMIN.password, understood: false }),
    ).toMatchObject({ ok: false, error: { msg: { key: 'promote.mustConfirm' } } });
    // Refused before anything happened: the main computer is still the main computer.
    expect(main.rt.runningServer!.cluster.role).toBe('main');
    expect(b.c.rt.info().role).toBe('backup');

    ok(await b.c.rt.promote({ email: ADMIN.email, password: ADMIN.password, understood: true }));
    expect(b.c.rt.info()).toMatchObject({ role: 'main', term: 2 });
  });
});

describe('the former main computer comes back', () => {
  it('refuses to register, hands over what is missing (conflicts listed), then becomes a station', async () => {
    const { main } = await setUpMain();
    const b = await addStation(main, 'Backup');
    const s1 = await addStation(main, 'S1');
    const s2 = await addStation(main, 'S2');
    await makeBackup(main, b.nodeId, b.c);
    await settle();

    // The backup goes offline; with both stations connected the main computer keeps registering.
    const backupSaved = b.c.saved;
    await b.c.rt.stop();
    running.delete(b.c.rt);
    await settle();
    expect(await result(s1.c, '13WAA000000020', 'P-1')).toMatchObject({ result: 'new' }); // missing
    expect(await result(s1.c, '13WAA000000021', 'P-1')).toMatchObject({ result: 'new' }); // conflict

    // The main computer breaks down; the backup is started again and promoted.
    const mainSaved = main.saved;
    await main.rt.stop();
    running.delete(main.rt);
    const backup = computer('Backup', backupSaved);
    await backup.rt.start();
    ok(await backup.rt.promote({ email: ADMIN.email, password: ADMIN.password, understood: true }));
    await waitFor(() => online(s1.c) && s1.c.rt.info().term === 2, 10_000, 'S1 switched');
    await waitFor(() => online(s2.c) && s2.c.rt.info().term === 2, 10_000, 'S2 switched');
    await settle();
    // Registered on the new main computer too, with other details.
    expect(await result(s1.c, '13WAA000000021', 'P-2')).toMatchObject({ result: 'new' });

    // The former main computer comes back. Before it knows, it cannot register: the backup is
    // not copying from it and the stations follow the new main computer (two main computers can
    // never both register).
    const old = computer('main', mainSaved);
    await old.rt.start();
    await settle();
    expect(await result(old, '13WAA000000022')).toMatchObject({ result: 'error' });
    // It finds the new main computer and stops being a main computer.
    await waitFor(() => old.rt.info().role === 'retired', 15_000, 'old main retired');
    expect(await result(old, '13WAA000000022')).toMatchObject({ code: 'not-main' });
    expect(await result(s1.c, '13WAA000000022')).toMatchObject({ result: 'new' }); // new main OK

    // Wrong password: nothing happens.
    expect(await old.rt.handover({ email: ADMIN.email, password: 'wrong-pass' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-credentials' },
    });
    expect(old.rt.info().role).toBe('retired');

    const handed = ok(await old.rt.handover({ email: ADMIN.email, password: ADMIN.password }));
    expect(handed).toMatchObject({ serialsAdded: 1, conflicts: 1 });
    expect(handed.scansAdded).toBeGreaterThanOrEqual(2);
    expect(old.rt.info()).toMatchObject({ mode: 'node', role: 'station' });
    // Its old database is gone (a station keeps no data).
    expect(existsSync(join(old.dir, 'server', 'serials.db'))).toBe(false);

    // The missing serial is now on the new main computer; the conflict is listed for the admin.
    expect(await result(s2.c, '13WAA000000020', 'P-1')).toMatchObject({ result: 'duplicate' });
    await signIn(backup);
    const status = ok(await backup.rt.call('cluster.status', {}));
    expect(status.conflicts).toEqual([
      expect.objectContaining({
        serial: '13WAA000000021',
        partNo: 'P-2',
        otherPartNo: 'P-1',
        nodeName: 'S1',
        otherNodeName: 'S1',
      }),
    ]);

    // The former main computer now works as a station of the new main computer.
    await waitFor(() => online(old), 10_000, 'former main online as a station');
    expect(await result(old, '13WAA000000023')).toMatchObject({ result: 'new' });
  });
});

describe('one main computer per network', () => {
  it('setting up a second main computer on the same network is blocked', async () => {
    await setUpMain('Office PC');
    const second = computer('Workshop PC');
    const r = await second.rt.setupServer(ADMIN);
    expect(r).toMatchObject({
      ok: false,
      error: { msg: { key: 'setup.mainExists', params: { name: 'Office PC' } } },
    });
    expect(r.ok ? '' : r.error.message).toBe(
      "A main computer already exists on this network (Office PC). Set this PC up as a station instead, or use the backup if you're replacing it.",
    );
    // Nothing was set up on it.
    expect(second.rt.mode).toBeNull();
    expect(existsSync(join(second.dir, 'server'))).toBe(false);
  });

  it('two systems on one network: a new station asks which one; both main computers warn', async () => {
    const { main: office } = await setUpMain('Office PC');
    // A second system, set up elsewhere, then brought onto this network.
    const elsewhere = new FakeNetwork();
    const { main: workshop } = await setUpMain('Workshop PC', elsewhere);
    const w = workshop.rt.runningServer!;
    const o = office.rt.runningServer!;
    const stopW = net.announce({
      serverId: w.serverId,
      port: w.port,
      instance: 'workshop',
      computerName: 'Workshop PC',
    });
    elsewhere.announce({
      serverId: o.serverId,
      port: o.port,
      instance: 'office',
      computerName: 'Office PC',
    });

    // A new station finds both and does not pick one.
    const s = computer('New station');
    s.rt.startDiscovery();
    const found = () => {
      const e = [...s.events].reverse().find((x) => x.type === 'discovery');
      return e?.type === 'discovery' ? e.servers : [];
    };
    await waitFor(() => found().length === 2, 5_000, 'both found');
    expect(
      found()
        .map((x) => x.name)
        .sort(),
    ).toEqual(['Office PC', 'Workshop PC']);
    expect(serverChoice(found(), null)).toEqual({ server: undefined, mustChoose: true });
    expect(serverChoice(found(), w.serverId).server?.name).toBe('Workshop PC');
    s.rt.stopDiscovery();
    // With one found, it is used directly.
    expect(serverChoice(found().slice(0, 1), null)).toMatchObject({ mustChoose: false });

    // Admins on both main computers are warned about the other one.
    expect(ok(await office.rt.call('cluster.status', {})).otherSystems).toEqual([
      { serverId: w.serverId, name: 'Workshop PC' },
    ]);
    expect(ok(await workshop.rt.call('cluster.status', {})).otherSystems).toEqual([
      { serverId: o.serverId, name: 'Office PC' },
    ]);
    // The other one leaves the network: the warning goes away.
    stopW();
    expect(ok(await office.rt.call('cluster.status', {})).otherSystems).toEqual([]);
  });
});

describe('removing the backup station', () => {
  it('erases its copy, nothing is copied any more, and the admin is asked for a new backup', async () => {
    const { main } = await setUpMain();
    const b = await addStation(main, 'Backup');
    await makeBackup(main, b.nodeId, b.c);
    expect(existsSync(join(b.c.dir, 'server', 'serials.db'))).toBe(true);

    ok(await main.rt.call('nodes.revoke', { nodeId: b.nodeId }));
    // The removed backup erases its copy as soon as it hears it was removed.
    await waitFor(() => b.c.rt.info().connection === 'revoked', 10_000, 'backup told');
    await waitFor(() => !existsSync(join(b.c.dir, 'server')), 10_000, 'copy erased');
    expect(b.c.rt.info()).toMatchObject({ role: 'station', backupCopy: null });

    const status = ok(await main.rt.call('cluster.status', {}));
    expect(status).toMatchObject({ backup: null, needsBackup: true });
    // No backup now: registering continues (nothing could be promoted).
    await settle();
    expect(await result(main, '13WAA000000090')).toMatchObject({ result: 'new' });
  });
});

describe('changing the backup', () => {
  it('moves the role; the previous backup erases its copy', async () => {
    const { main } = await setUpMain();
    const b = await addStation(main, 'Backup');
    const s = await addStation(main, 'S1');
    await makeBackup(main, b.nodeId, b.c);
    expect(existsSync(join(b.c.dir, 'server', 'serials.db'))).toBe(true);
    await makeBackup(main, s.nodeId, s.c);
    await waitFor(() => b.c.rt.info().role === 'station', 10_000, 'previous backup demoted');
    expect(existsSync(join(b.c.dir, 'server'))).toBe(false);
    await signIn(main);
    const status = ok(await main.rt.call('cluster.status', {}));
    expect(status.backup).toMatchObject({ nodeId: s.nodeId, name: 'S1' });
  });
});
