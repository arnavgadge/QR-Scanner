// Real mDNS on this computer: the server announces its permanent ID, a station finds it by that ID.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Announcer, ServerBrowser, type FoundServer } from '../src/net/discovery';
import { waitFor } from './helpers';

describe('discovery (mDNS)', () => {
  it('a station finds the server by its ID, with an address and port, and no IP is typed', async () => {
    const serverId = randomUUID();
    const announcer = new Announcer({ serverId, version: '1.0.0', port: 47999 });
    const found: FoundServer[] = [];
    const browser = new ServerBrowser((s) => found.push(s), 500);
    try {
      await waitFor(() => found.some((s) => s.serverId === serverId), 10_000, 'mDNS answer');
      const me = found.find((s) => s.serverId === serverId)!;
      expect(me.port).toBe(47999);
      expect(me.host).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      expect(me.version).toBe('1.0.0');
    } finally {
      browser.close();
      announcer.close();
    }
  });
});
