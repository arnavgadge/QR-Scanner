/**
 * This computer's settings as data (no Electron), plus what the runtime needs from the outside
 * world, so the runtime can be tested without Electron (tests/runtime.test.ts).
 */
import type { DesktopMode } from '../../../web/src/desktop/bridge';
import type { DiscoverySource, StationCredentials } from '../node/link';

export interface StoredStation {
  serverId: string;
  nodeId: string;
  certPem: string;
  /** Protected token (see RuntimeDeps.protect). */
  token: string;
  /** Certificates of the backup and former main computers (shared by the main computer). */
  knownCerts?: string[];
  /** Highest term known (raised by every promotion). */
  term?: number;
}

export interface StoredConfig {
  mode: DesktopMode | null;
  stationName: string;
  station: StoredStation | null;
  printer: string | null;
  /** This station is the backup main computer (keeps a copy of all data in serverDataDir). */
  backup?: boolean;
}

export const EMPTY_CONFIG: StoredConfig = {
  mode: null,
  stationName: '',
  station: null,
  printer: null,
};

export interface RuntimeDeps {
  loadConfig(): StoredConfig;
  saveConfig(config: StoredConfig): void;
  /** Folder of the server's single database file and certificate. */
  serverDataDir: string;
  /** Server port (default 47820; tests use 0). */
  serverPort?: number;
  /** Encrypts / decrypts the station token at rest (Windows DPAPI in the app). */
  protect(token: string): string;
  reveal(stored: string): string;
  /** Finding servers (default: mDNS). Tests use a fake network. */
  discovery?: () => DiscoverySource;
  /** Announcing this computer's server (default: mDNS). Returns a function that stops it. */
  announce?: (info: {
    serverId: string;
    port: number;
    instance: string;
    computerName: string;
  }) => () => void;
  /** This computer's name on the network (default: the OS computer name). */
  computerName?: string;
  /** How long setup listens for an existing main computer (default 4 s). */
  searchMs?: number;
  /** Liveness timing of the network-split rule (tests use short ones). */
  serverTiming?: { heartbeatMs: number; leaseMs: number };
}

export function stationCredentials(
  config: StoredConfig,
  reveal: RuntimeDeps['reveal'],
): StationCredentials | null {
  const s = config.station;
  if (!s) return null;
  try {
    return {
      serverId: s.serverId,
      nodeId: s.nodeId,
      certPem: s.certPem,
      nodeToken: reveal(s.token),
      ...(s.knownCerts ? { knownCerts: s.knownCerts } : {}),
      ...(s.term ? { term: s.term } : {}),
    };
  } catch {
    return null; // cannot decrypt (e.g. copied from another computer): pair again
  }
}

export function storeStation(
  config: StoredConfig,
  creds: StationCredentials,
  protect: RuntimeDeps['protect'],
): StoredConfig {
  return {
    ...config,
    station: {
      serverId: creds.serverId,
      nodeId: creds.nodeId,
      certPem: creds.certPem,
      token: protect(creds.nodeToken),
      ...(creds.knownCerts ? { knownCerts: creds.knownCerts } : {}),
      ...(creds.term ? { term: creds.term } : {}),
    },
  };
}
