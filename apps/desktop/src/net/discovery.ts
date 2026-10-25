/**
 * Finding the server on the office network without anyone typing an address (mDNS / DNS-SD via
 * `bonjour-service`). The server announces "_vicimus-station._tcp" with its permanent server ID;
 * stations look for the ID they were paired with and ignore everything else, so the address may
 * change at any time (DHCP) and is only ever shown in the Advanced section.
 */
import { networkInterfaces } from 'node:os';
import { Bonjour, type Browser, type Service } from 'bonjour-service';
import { SERVICE_TYPE } from '../../../web/src/desktop/protocol';
import { describeError, logger } from '../log';

const log = logger('mdns');

/**
 * mDNS socket errors (e.g. macOS while Local Network access is not yet allowed, or a network with
 * multicast blocked) are logged, never thrown: by default bonjour-service throws them uncaught.
 * Discovery failing never affects the server itself or the server computer's own window.
 */
const onMdnsError = (what: string) => (err: unknown) => log.warn(`${what}: ${describeError(err)}`);

export interface FoundServer {
  serverId: string;
  /**
   * Which computer (start of its certificate fingerprint): the main computer and its backup share
   * the server ID, so this tells their announcements apart. Not trusted: TLS pinning decides.
   */
  instance?: string;
  /** The computer's name (shown to people: "A main computer already exists … (OFFICE-PC)"). */
  label?: string;
  name: string;
  version: string;
  host: string;
  port: number;
}

/** This computer's IPv4 LAN addresses (for the Advanced section and for change detection). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out.sort();
}

/** Server side: keep announcing; re-announce when this computer's addresses change. */
export class Announcer {
  private readonly bonjour = new Bonjour({}, onMdnsError('announcing failed'));
  private service: Service | null = null;
  private lastAddresses = '';
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly info: {
      serverId: string;
      version: string;
      port: number;
      instance?: string;
      computerName?: string;
    },
  ) {
    this.publish();
    this.timer = setInterval(() => {
      if (lanAddresses().join(',') !== this.lastAddresses) this.publish();
    }, 5_000);
    this.timer.unref();
  }

  private publish() {
    const addresses = lanAddresses();
    const changed = this.lastAddresses !== '' && this.lastAddresses !== addresses.join(',');
    this.lastAddresses = addresses.join(',');
    const name = `VICIMUS Station Server ${this.info.serverId.slice(0, 8)}${this.info.instance ? ` ${this.info.instance.slice(0, 8)}` : ''}`;
    try {
      this.service?.stop?.();
      this.service = this.bonjour.publish({
        name,
        type: SERVICE_TYPE,
        port: this.info.port,
        txt: {
          id: this.info.serverId,
          v: this.info.version,
          ...(this.info.instance ? { fp: this.info.instance } : {}),
          ...(this.info.computerName ? { name: this.info.computerName.slice(0, 60) } : {}),
        },
        disableIPv6: true,
      });
      this.service.on('error', onMdnsError('announcement error'));
      log.info(
        `${changed ? 'addresses changed, re-announcing' : 'announcing'} "${name}" (_${SERVICE_TYPE}._tcp) on port ${this.info.port}, addresses: ${addresses.join(', ') || 'none (no network?)'}`,
      );
    } catch (e) {
      log.warn(`could not announce on the network: ${describeError(e)}`);
    }
  }

  close() {
    clearInterval(this.timer);
    try {
      this.bonjour.unpublishAll();
      this.bonjour.destroy();
    } catch (e) {
      log.warn(`closing the announcement: ${describeError(e)}`);
    }
  }
}

/** Station side: continuously browse; report every server seen (with its current address). */
export class ServerBrowser {
  private readonly bonjour = new Bonjour({}, onMdnsError('searching failed'));
  private readonly browser: Browser;
  private readonly timer: NodeJS.Timeout;

  constructor(
    onFound: (server: FoundServer) => void,
    requeryMs = 3_000,
    onLost?: (server: FoundServer) => void,
  ) {
    this.browser = this.bonjour.find({ type: SERVICE_TYPE });
    const report = (s: Service) => {
      const found = toFound(s);
      if (found) onFound(found);
    };
    this.browser.on('up', report);
    this.browser.on('srv-update', report);
    this.browser.on('txt-update', report);
    this.browser.on('down', (s: Service) => {
      const found = toFound(s);
      if (found) onLost?.(found);
    });
    // Ask again regularly: answers are cached by TTL, and a server whose address changed answers
    // the next query with its new address.
    this.timer = setInterval(() => this.browser.update(), requeryMs);
    this.timer.unref();
  }

  /** Ask the network right now (e.g. after a connection failure). */
  refresh() {
    this.browser.update();
  }

  close() {
    clearInterval(this.timer);
    try {
      this.browser.stop();
      this.bonjour.destroy();
    } catch (e) {
      log.warn(`closing the search: ${describeError(e)}`);
    }
  }
}

function toFound(s: Service): FoundServer | null {
  const id = typeof s.txt?.id === 'string' ? s.txt.id : null;
  if (!id) return null;
  const host =
    s.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? s.referer?.address ?? null;
  if (!host) return null;
  return {
    serverId: id,
    ...(typeof s.txt?.fp === 'string' ? { instance: s.txt.fp } : {}),
    ...(typeof s.txt?.name === 'string' ? { label: s.txt.name } : {}),
    name: s.name,
    version: typeof s.txt?.v === 'string' ? s.txt.v : '',
    host,
    port: s.port,
  };
}
