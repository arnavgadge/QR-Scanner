// Pairing a station with the 6-digit code (SRP-6a): valid / expired / reused codes, lockout after
// 5 wrong codes, and the code never appearing in anything sent over the network.
import { connect as tcpConnect, createServer as tcpServer } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../web/src/services/errors';
import { CODE_LIFETIME_MS, LOCKOUT_MS, MAX_WRONG_CODES } from '../src/server/pairing';
import { postJson } from '../src/node/https';
import { httpsPairTransport, type PairTransport } from '../src/node/pairingClient';
import {
  endpointOf,
  linkTo,
  pairStation,
  startTestServer,
  VERSION,
  type TestServer,
} from './helpers';

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
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
const wrongCodeFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('pairing with the 6-digit code', () => {
  it('a valid code pairs the station: it gets its own credential and the pinned certificate', async () => {
    const creds = await pairStation(t.server, 'Station 2');
    expect(creds.serverId).toBe(t.server.serverId);
    expect(creds.certPem).toBe(t.server.certPem);
    expect(creds.nodeToken.length).toBeGreaterThanOrEqual(40);
    const { link } = linkTo(t.server, creds);
    expect(await link.call('hello', {})).toMatchObject({
      serverId: t.server.serverId,
      station: { name: 'Station 2', configured: false },
    });
    link.close();
    // each station has a different credential
    const other = await pairStation(t.server, 'Station 3');
    expect(other.nodeToken).not.toBe(creds.nodeToken);
    expect(other.nodeId).not.toBe(creds.nodeId);
  });

  it('an expired code (older than 30 s) is refused', async () => {
    t.server.pairing.open();
    const old = t.server.pairing.status().code;
    t.clock.advance(CODE_LIFETIME_MS + 1);
    expect(await errorCode(pairStation(t.server, 'Late', { code: old }))).toBe(
      'invalid-credentials',
    );
    expect(t.server.pairing.status().code).not.toBe(old);
  });

  it('a code works once: reusing it is refused', async () => {
    t.server.pairing.open();
    const code = t.server.pairing.status().code;
    await pairStation(t.server, 'First', { code });
    expect(await errorCode(pairStation(t.server, 'Second', { code }))).toBe('invalid-credentials');
  });

  it(`locks pairing for 5 minutes after ${MAX_WRONG_CODES} wrong codes (even the right code is refused)`, async () => {
    t.server.pairing.open();
    for (let i = 0; i < MAX_WRONG_CODES; i++) {
      const wrong = wrongCodeFor(t.server.pairing.status().code);
      expect(await errorCode(pairStation(t.server, 'Guess', { code: wrong }))).toBe(
        'invalid-credentials',
      );
    }
    const right = t.server.pairing.status().code;
    expect(await errorCode(pairStation(t.server, 'Real', { code: right }))).toBe('locked');
    expect(t.server.pairing.status().lockedUntil).not.toBeNull();
    t.clock.advance(LOCKOUT_MS + 1);
    t.server.pairing.open();
    await expect(pairStation(t.server, 'Real')).resolves.toMatchObject({
      serverId: t.server.serverId,
    });
  });

  it('is refused when nobody opened "Add station" on the server', async () => {
    expect(t.server.pairing.status().open).toBe(false);
    const transport = httpsPairTransport(endpointOf(t.server));
    const r = await transport('/pair/start', {});
    expect(r.body).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
  });

  it('the code never appears in network traffic (messages and raw bytes)', async () => {
    t.server.pairing.open();
    const code = t.server.pairing.status().code;

    // 1) Every application message, both directions, before encryption.
    const messages: string[] = [];
    const base = httpsPairTransport(endpointOf(t.server));
    const recording: PairTransport = async (path, body) => {
      messages.push(JSON.stringify(body));
      const res = await base(path, body);
      messages.push(JSON.stringify(res.body));
      return res;
    };

    // 2) Every raw byte on the wire, through a TCP relay in front of the server.
    const wire: Buffer[] = [];
    const relay = tcpServer((client) => {
      const upstream = tcpConnect(t.server.port, '127.0.0.1');
      client.on('data', (d: Buffer) => (wire.push(d), upstream.write(d)));
      upstream.on('data', (d: Buffer) => (wire.push(d), client.write(d)));
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>((r) => relay.listen(0, '127.0.0.1', () => r()));
    const relayPort = (relay.address() as { port: number }).port;
    const viaRelay: PairTransport = async (path, body) => {
      const res = await postJson({ host: '127.0.0.1', port: relayPort }, path, body, {}, null);
      messages.push(JSON.stringify(body), JSON.stringify(res.body));
      return res;
    };

    await pairStation(t.server, 'Recorded', { code, transport: recording });
    t.server.pairing.open();
    const code2 = t.server.pairing.status().code;
    await pairStation(t.server, 'Relayed', { code: code2, transport: viaRelay });
    relay.close();

    expect(messages.length).toBeGreaterThanOrEqual(8);
    const all = messages.join('\n');
    const raw = Buffer.concat(wire);
    for (const c of [code, code2]) {
      const forms = [
        c,
        Buffer.from(c).toString('hex'),
        Buffer.from(c).toString('base64'),
        String(Number(c)),
      ];
      for (const f of forms.filter((x) => x.length >= 4)) {
        expect(all, `code form ${f} in messages`).not.toContain(f);
      }
      expect(raw.includes(Buffer.from(c)), 'code bytes on the wire').toBe(false);
    }
  });

  it('a station with a different app version can pair but is told to update and cannot register', async () => {
    const creds = await pairStation(t.server, 'Old', { version: '0.9.0' });
    const { link } = linkTo(t.server, creds, { version: '0.9.0' });
    expect(await errorCode(link.call('hello', {}))).toBe('update-required');
    expect(link.state).toBe('update-required');
    link.close();
    expect(VERSION).not.toBe('0.9.0');
  });
});
