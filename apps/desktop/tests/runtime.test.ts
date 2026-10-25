// The main computer's own window must always reach its own server (the real Runtime, server mode):
// first start, restart, and an upgrade from an older certificate that Electron's TLS rejected.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DesktopEvent } from '../../web/src/desktop/bridge';
import { setLogSink, type LogSink } from '../src/log';
import { EMPTY_CONFIG, type RuntimeDeps, type StoredConfig } from '../src/main/configModel';
import { Runtime } from '../src/main/runtime';
import { isUsableAnchor } from '../src/server/certificate';
import { waitFor } from './helpers';

const VERSION = '1.0.0-test';
const ADMIN = { name: 'Ada Admin', email: 'admin@example.test', password: 'adminpass1' };
const COMPANY = {
  name: 'Company A',
  codeType: 'barcode' as const,
  serialFormat: '13WAA#########',
  active: true,
};

let dir: string;
let saved: StoredConfig;
let logs: string[];
let restoreSink: LogSink;
const runtimes: Runtime[] = [];

const deps = (): RuntimeDeps => ({
  loadConfig: () => structuredClone(saved),
  saveConfig: (c) => (saved = structuredClone(c)),
  serverDataDir: join(dir, 'server'),
  serverPort: 0,
  protect: (t) => `test:${t}`,
  reveal: (s) => s.replace(/^test:/, ''),
  // A quiet network: these tests never listen to (or find) real computers on the LAN.
  discovery: () => ({ start: () => undefined, refresh: () => undefined, stop: () => undefined }),
  searchMs: 0,
});

function startRuntime() {
  const events: DesktopEvent[] = [];
  const rt = new Runtime(VERSION, (e) => events.push(e), deps());
  runtimes.push(rt);
  const online = () => events.some((e) => e.type === 'connection' && e.state === 'online');
  return { rt, events, online };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vicimus-runtime-'));
  saved = { ...EMPTY_CONFIG };
  logs = [];
  restoreSink = setLogSink((level, scope, message) => logs.push(`${level} [${scope}] ${message}`));
});
afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.stop();
  setLogSink(restoreSink);
  rmSync(dir, { recursive: true, force: true });
});

describe("main computer's own window", () => {
  it('first start: main computer set up, its own station set up once, then it scans without a sign-in', async () => {
    const { rt, online } = startRuntime();
    expect(rt.mode).toBeNull();
    // Setup gives the admin password recovery code (shown once).
    expect(await rt.setupServer(ADMIN)).toEqual({
      ok: true,
      data: { recoveryCode: expect.stringMatching(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/) },
    });
    await waitFor(online, 10_000, 'own window online');

    // The main computer's own scan screen is a station like any other: one-time setup first.
    expect(await rt.call('hello', {})).toMatchObject({
      ok: true,
      data: { station: { name: 'Main computer', configured: false, isServer: true } },
    });
    expect(
      await rt.call('station.setup', { name: 'Main desk', operatorName: 'Asha' }),
    ).toMatchObject({ ok: true });

    // Admin pages need an administrator sign-in…
    expect(await rt.call('companies.create', { input: COMPANY })).toMatchObject({
      ok: false,
      error: { code: 'session-expired' },
    });
    expect(await rt.call('pairing.open', {})).toMatchObject({
      ok: false,
      error: { code: 'session-expired' },
    });
    const login = await rt.call('auth.login', { email: ADMIN.email, password: ADMIN.password });
    expect(login).toMatchObject({
      ok: true,
      data: { email: ADMIN.email, session: '', idleMinutes: 15 },
    }); // token stays in main
    expect(await rt.call('pairing.open', {})).toMatchObject({ ok: true, data: { open: true } });
    expect(await rt.call('companies.create', { input: COMPANY })).toMatchObject({ ok: true });
    await rt.call('auth.logout', {});

    // …scanning does not.
    expect(rt.signedIn()).toBeNull();
    expect(
      await rt.call('serials.register', {
        serial: '13WAA000000001',
        companyId: 'company-a',
        source: 'manual',
      }),
    ).toMatchObject({
      ok: true,
      data: { result: 'new', nodeName: 'Main desk', scannedByName: 'Asha' },
    });
  });

  it('restart: opens straight to scanning; no sign-in is ever asked', async () => {
    const first = startRuntime();
    await first.rt.setupServer(ADMIN);
    await waitFor(first.online, 10_000, 'first start online');
    await first.rt.call('station.setup', { name: 'Main desk', operatorName: '' });
    await first.rt.call('auth.login', { email: ADMIN.email, password: ADMIN.password });
    await first.rt.call('companies.create', { input: COMPANY });
    await first.rt.stop();

    const again = startRuntime();
    await again.rt.start();
    await waitFor(again.online, 10_000, 'restart online');
    expect(again.rt.signedIn()).toBeNull();
    expect(await again.rt.call('hello', {})).toMatchObject({
      data: { station: { name: 'Main desk', configured: true } },
    });
    expect(
      await again.rt.call('serials.register', {
        serial: '13WAA000000002',
        companyId: 'company-a',
        source: 'manual',
      }),
    ).toMatchObject({
      ok: true,
      data: { result: 'new', nodeName: 'Main desk' },
    });
  });

  it('upgrade from an older certificate that Electron could not verify: replaced, window still connects', async () => {
    const first = startRuntime();
    await first.rt.setupServer(ADMIN);
    await waitFor(first.online, 10_000, 'first start online');
    await first.rt.stop();

    // What the previous version wrote: CA:FALSE, no keyCertSign (BoringSSL rejects it as a pin).
    const old = await generate([{ name: 'commonName', value: 'old' }], {
      keySize: 2048,
      algorithm: 'sha256',
    });
    expect(isUsableAnchor(old.cert)).toBe(false);
    writeFileSync(join(dir, 'server', 'server-cert.pem'), old.cert);
    writeFileSync(join(dir, 'server', 'server-key.pem'), old.private);
    saved = { ...saved, station: { ...saved.station!, certPem: old.cert } };

    const again = startRuntime();
    await again.rt.start();
    await waitFor(again.online, 10_000, 'online after certificate replacement');
    expect(isUsableAnchor(saved.station!.certPem)).toBe(true);
    expect(logs.some((l) => l.includes('TLS certificate replaced'))).toBe(true);
    expect(
      await again.rt.call('auth.login', { email: ADMIN.email, password: ADMIN.password }),
    ).toMatchObject({ ok: true });
  });

  it('startup and connection failures are logged with their reason (never silent)', async () => {
    const { rt, online, events } = startRuntime();
    await rt.setupServer(ADMIN);
    await waitFor(online, 10_000, 'online');
    for (const expected of [
      '[server] database',
      '[server] TLS certificate created, SHA-256',
      '[server] listening on',
      "[link] connecting to this computer's own server",
    ]) {
      expect(
        logs.some((l) => l.includes(expected)),
        expected,
      ).toBe(true);
    }
    // Take the server away under the window: the failure and its reason reach the log.
    await (rt as unknown as { server: { close(): Promise<void> } }).server.close();
    await waitFor(
      () => events.some((e) => e.type === 'connection' && e.state === 'offline'),
      10_000,
      'offline',
    );
    const r = await rt.call('me', {});
    expect(r).toMatchObject({ ok: false, error: { code: 'server-unreachable' } });
    expect(
      logs.some((l) => /warn \[link\] .*(ECONNREFUSED|ECONNRESET|closed|failed)/.test(l)),
    ).toBe(true);
  });
});
