// Desktop data service (renderer side) with a fake Electron bridge: registration is refused, with
// nothing sent, whenever the link to the main computer is not online (no local queue).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBridge, DesktopEvent } from '../src/desktop/bridge';

let listeners: ((e: DesktopEvent) => void)[];
let calls: string[];
let bridge: DesktopBridge;

beforeEach(() => {
  vi.resetModules();
  listeners = [];
  calls = [];
  bridge = {
    info: async () => ({
      mode: 'node',
      appVersion: '1',
      stationName: 'S',
      connection: 'offline',
      serverId: 'x',
      serverAddress: null,
      lanAddresses: [],
      dbFile: null,
    }),
    on: (l) => (listeners.push(l), () => undefined),
    call: async (op) => {
      calls.push(op);
      if (op === 'serials.register') {
        return {
          ok: true,
          data: {
            result: 'invalid',
            serial: '',
            reason: 'empty',
            message: 'm',
            msg: { key: 'verify.empty' },
          },
        } as never;
      }
      return {
        ok: false,
        error: { code: 'permission-denied', message: 'no', msg: { key: 'auth.noPermission' } },
      } as never;
    },
    signedIn: async () => null,
  } as Partial<DesktopBridge> as DesktopBridge;
  vi.stubGlobal('window', { desktop: bridge });
});
afterEach(() => vi.unstubAllGlobals());

const emit = (e: DesktopEvent) => listeners.forEach((l) => l(e));
const load = async () =>
  (await import('../src/data/desktop/desktopDataService')).desktopDataService;
const input = { serial: '13WAA000000001', companyId: 'c', source: 'manual' as const };

describe('desktop data service', () => {
  it('offline: registration is refused with "server unreachable" and nothing is sent', async () => {
    const ds = await load();
    const states: string[] = [];
    ds.onConnectionChange((s) => states.push(s));
    await Promise.resolve();
    emit({ type: 'connection', state: 'offline' });
    const r = await ds.registerSerial(input);
    expect(r).toMatchObject({
      result: 'error',
      code: 'server-unreachable',
      msg: { key: 'server.unreachable' },
    });
    expect(calls).not.toContain('serials.register');
    expect(states).toContain('offline');
  });

  it('wrong version: refused as "update required"', async () => {
    const ds = await load();
    ds.onConnectionChange(() => undefined);
    emit({ type: 'connection', state: 'update-required' });
    expect(await ds.registerSerial(input)).toMatchObject({ code: 'update-required' });
    expect(calls).not.toContain('serials.register');
  });

  it('online: registration goes to the main computer; errors come back translatable', async () => {
    const ds = await load();
    ds.onConnectionChange(() => undefined);
    emit({ type: 'connection', state: 'online' });
    await ds.registerSerial(input);
    expect(calls).toContain('serials.register');
    const err = await ds.getUsers().catch((e: unknown) => e);
    // (modules were reset per test, so compare by name, not by class identity)
    expect((err as Error).name).toBe('AppError');
    expect(err).toMatchObject({ code: 'permission-denied', msg: { key: 'auth.noPermission' } });
  });

  it('live events: a scan anywhere refreshes the history strip', async () => {
    const ds = await load();
    const onScan = vi.fn();
    ds.onScansChanged(onScan);
    emit({ type: 'server', event: { type: 'scan', scan: { id: '1' } as never } });
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
