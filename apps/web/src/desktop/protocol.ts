/**
 * Desktop wire protocol: the operations the main computer (server) offers to stations (nodes),
 * shared by the server, the node's main process and the renderer, so all three agree at compile
 * time. Pure types and constants only (no Node, no DOM, no Electron).
 *
 * Transport: HTTPS POST /api/<op> with a JSON body, over TLS pinned to the server's certificate.
 * Every request carries the station credential (x-node-token) and the app version
 * (x-app-version). Scanning needs only the station (stations never sign in); admin operations
 * also carry an administrator's session (x-session), which ends after a period of inactivity.
 * Live events: WebSocket /events on the same TLS port.
 */
import type { Msg } from '../i18n/core';
import type { CompanyInput } from '../services/companies/companyValidation';
import type { ImportPreview, ImportOutcome, RawImportRow } from '../services/excel/importTypes';
import type { AppErrorCode } from '../services/errors';
import type { ScanHistoryFilters } from '../services/admin/scanHistoryService';
import type { UserChange } from '../services/users/userChangeRules';
import type { VerificationResult } from '../services/serial/serialVerification';
import type {
  Company,
  ExportHistoryEntry,
  FoundSerial,
  ImportDetails,
  ImportHistoryEntry,
  Language,
  ScanLog,
  SerialSource,
  Theme,
  User,
  UserRole,
} from '../types';

/** mDNS / DNS-SD service type the server announces (_vicimus-station._tcp). */
export const SERVICE_TYPE = 'vicimus-station';
/** TCP port of the server (HTTPS + WebSocket). Opened by the installer's firewall rule. */
export const SERVER_PORT = 47820;

/** Errors cross the wire as data: an AppError code, English text, and the translatable form. */
export interface WireError {
  code: AppErrorCode;
  message: string;
  msg?: Msg;
}
export type WireResult<T> = { ok: true; data: T } | { ok: false; error: WireError };

/** Scan-history filters on the wire (dates as ISO strings). */
export type WireHistoryFilters = Omit<ScanHistoryFilters, 'from' | 'to'> & {
  from?: string;
  to?: string;
};

/** A serial row for the Excel export (scannedAt as ISO). */
export interface WireExportSerial {
  serial: string;
  partNo: string;
  company: string;
  companyId: string;
  source: string;
  scannedAt: string | null;
  scannedByName: string;
  nodeName: string;
}

export interface PairedNode {
  id: string;
  name: string;
  pairedAt: string;
  lastSeen: string | null;
  appVersion: string;
  /** The server's own window (cannot be removed). */
  isServer: boolean;
  /** Usual operator's name ('' = none); shown as "Station 2 (Ravi)". */
  operatorName: string;
  /** The one-time station setup (name, operator) has been done. */
  configured: boolean;
}

/** What a station knows about itself (from `hello`). */
export interface StationProfile {
  nodeId: string;
  name: string;
  operatorName: string;
  configured: boolean;
  isServer: boolean;
}

export interface PairingStatus {
  open: boolean;
  /** Current 6-digit code (shown on the server screen only; never sent during pairing). */
  code: string;
  /** Seconds until the code changes. */
  secondsLeft: number;
  /** Pairing refused until this time after 5 wrong codes (ISO), else null. */
  lockedUntil: string | null;
}

/**
 * Backup main computer and promotion. The cluster ID is the first main computer's server ID and
 * never changes; every promotion raises the term. Stations follow the highest term they have seen
 * and pin the TLS certificates of both the main computer and the backup, which the main computer
 * shares with them over the already pinned connection.
 */
export interface ClusterInfo {
  clusterId: string;
  term: number;
  /** Raised by every change of the backup (answers can arrive out of order: newest wins). */
  revision: number;
  /** 'retired' = a backup was made the main computer; this one no longer registers. */
  role: 'main' | 'retired';
  /** The answering server's own certificate. */
  certPem: string;
  backup: { nodeId: string; certPem: string | null } | null;
}

export interface ClusterStatus {
  term: number;
  role: 'main' | 'retired';
  backup: {
    nodeId: string;
    name: string;
    connected: boolean;
    /** Last time the backup had every change (ISO), else null. */
    lastCopiedAt: string | null;
    /** While the backup receives its first (full) copy: how much it has, 0–99; else null. */
    copyProgress: number | null;
    /** Connected and has every change. */
    upToDate: boolean;
  } | null;
  /** Set after a promotion until an administrator chooses a new backup. */
  needsBackup: boolean;
  /**
   * The network-split rule right now (server/cluster.ts): 'ok', 'waiting' (the computers needed
   * are connected but only just; a few seconds), 'paused', or 'not-main'.
   */
  registerState: 'ok' | 'waiting' | 'paused' | 'not-main';
  connectedStations: number;
  otherStations: number;
  /** Serials the former main computer registered that differ from records here. */
  conflicts: HandoverConflict[];
  /**
   * Main computers of OTHER systems announcing themselves on this network (one main computer per
   * network). A promoted backup is the same system and never listed.
   */
  otherSystems: { serverId: string; name: string }[];
}

export interface HandoverConflict {
  serial: string;
  company: string;
  companyId: string;
  /** What this computer has. */
  partNo: string;
  nodeName: string;
  scannedAt: string | null;
  /** What the former main computer had. */
  otherPartNo: string;
  otherNodeName: string;
  otherScannedAt: string | null;
  reportedAt: string;
}

/** Records the former main computer has that the new one may be missing. */
export interface HandoverRecords {
  serials: Record<string, unknown>[];
  scanLog: Record<string, unknown>[];
  imports: { history: Record<string, unknown>; items: Record<string, unknown>[] }[];
}

export interface HandoverResult {
  serialsAdded: number;
  serialsSame: number;
  conflicts: number;
  scansAdded: number;
  importsAdded: number;
}

export interface ServerSettings {
  /** Administrator sign-ins end after this many minutes without activity. */
  adminIdleMinutes: number;
}

export type DashboardMetric =
  | 'serials'
  | 'serialsForCompany'
  | 'serialsRegisteredBetween'
  | 'duplicateAttemptsBetween'
  | 'companies'
  | 'activeCompanies'
  | 'activeOperators';

/**
 * Who may call an operation:
 *  station      any paired station (scanning; no person signs in)
 *  signed-in    an administrator's session on this station (own profile, sign-out)
 *  admin        an administrator's session
 *  admin-local  an administrator on the server computer itself (pairing codes)
 */
export type Access = 'station' | 'signed-in' | 'admin' | 'admin-local';

interface Op<In, Out, A extends Access> {
  in: In;
  out: Out;
  access: A;
}

export interface Ops {
  hello: Op<
    Record<string, never>,
    { serverId: string; version: string; station: StationProfile; cluster: ClusterInfo },
    'station'
  >;
  /** One-time station setup right after pairing (later changes: an admin, nodes.update). */
  'station.setup': Op<{ name: string; operatorName: string }, StationProfile, 'station'>;
  'auth.login': Op<
    { email: string; password: string },
    { session: string; uid: string; email: string; idleMinutes: number },
    'station'
  >;
  'auth.logout': Op<Record<string, never>, null, 'signed-in'>;
  me: Op<Record<string, never>, User, 'signed-in'>;
  'prefs.save': Op<{ language: Language; theme: Theme }, null, 'signed-in'>;

  'serials.register': Op<
    { serial: string; companyId: string; source: SerialSource; partNo?: string },
    VerificationResult,
    'station'
  >;
  'scans.recent': Op<{ count: number }, ScanLog[], 'station'>;
  'scans.history': Op<
    { filters: WireHistoryFilters; after: number | null },
    {
      entries: ScanLog[];
      partNumbers: Record<string, string>;
      cursor: number | null;
      hasMore: boolean;
    },
    'admin'
  >;

  'companies.active': Op<Record<string, never>, Company[], 'station'>;
  'companies.all': Op<Record<string, never>, Company[], 'admin'>;
  'companies.create': Op<{ input: CompanyInput }, string, 'admin'>;
  'companies.update': Op<{ id: string; input: CompanyInput }, null, 'admin'>;

  'users.list': Op<Record<string, never>, User[], 'admin'>;
  'users.create': Op<
    { name: string; email: string; role: UserRole; password: string },
    null,
    'admin'
  >;
  'users.setPassword': Op<{ uid: string; password: string }, null, 'admin'>;
  'users.change': Op<{ uid: string; change: UserChange }, null, 'admin'>;

  counts: Op<
    { metric: DashboardMetric; companyId?: string; start?: string; end?: string },
    number,
    'admin'
  >;

  'import.preview': Op<
    { filename: string; sheetName: string; sheets: ImportPreview['sheets']; rows: RawImportRow[] },
    ImportPreview,
    'admin'
  >;
  'import.confirm': Op<
    { preview: ImportPreview },
    { outcome: ImportOutcome; historyRecorded: boolean },
    'admin'
  >;
  'import.history': Op<{ count: number }, ImportHistoryEntry[], 'admin'>;
  'import.details': Op<{ importId: string }, ImportDetails, 'admin'>;

  /** Find any serial (exact or by its first characters), registered at a station or imported. */
  'serials.search': Op<{ query: string }, FoundSerial[], 'admin'>;
  /** Admin reprint of an existing serial's label: logged in Scan History as a reprint. */
  'labels.reprint': Op<{ companyId: string; serial: string }, FoundSerial, 'admin'>;

  'export.data': Op<
    Record<string, never>,
    { serials: WireExportSerial[]; companies: Company[] },
    'admin'
  >;
  'export.record': Op<{ filename: string; recordCount: number }, null, 'admin'>;
  'export.history': Op<{ count: number }, ExportHistoryEntry[], 'admin'>;

  'nodes.list': Op<Record<string, never>, PairedNode[], 'admin'>;
  'nodes.revoke': Op<{ nodeId: string }, null, 'admin'>;
  'nodes.update': Op<{ nodeId: string; name: string; operatorName: string }, null, 'admin'>;
  'settings.get': Op<Record<string, never>, ServerSettings, 'admin'>;
  'settings.set': Op<ServerSettings, null, 'admin'>;

  // ---- backup main computer ----
  'cluster.status': Op<Record<string, never>, ClusterStatus, 'admin'>;
  /** Makes this station the backup (moves the role; the previous backup erases its copy). */
  'cluster.setBackup': Op<{ nodeId: string }, null, 'admin'>;
  /** The designated backup hands over its TLS certificate (shared with every station). */
  'cluster.registerBackup': Op<{ certPem: string }, null, 'station'>;
  /** Planned switch: the designated backup asks the main computer to step down first. */
  'cluster.stepDown': Op<{ term: number }, { finalSeq: number }, 'station'>;
  /** A former main computer sends what the new one may be missing (serials, scans, imports). */
  'cluster.handover': Op<{ records: HandoverRecords }, HandoverResult, 'admin'>;
  'cluster.clearConflicts': Op<Record<string, never>, null, 'admin'>;

  /** Forgotten admin password: the recovery code sets a new one (on the main computer itself). */
  'auth.recover': Op<
    { email: string; code: string; newPassword: string },
    { recoveryCode: string },
    'station'
  >;
  'recovery.regenerate': Op<Record<string, never>, { recoveryCode: string }, 'admin-local'>;

  'pairing.open': Op<Record<string, never>, PairingStatus, 'admin-local'>;
  'pairing.status': Op<Record<string, never>, PairingStatus, 'admin-local'>;
  'pairing.close': Op<Record<string, never>, null, 'admin-local'>;
}

export type OpName = keyof Ops;
export type OpIn<K extends OpName> = Ops[K]['in'];
export type OpOut<K extends OpName> = Ops[K]['out'];

/** Access level per operation, enforced by the server (the type above documents the same). */
export const OP_ACCESS: { [K in OpName]: Ops[K]['access'] } = {
  hello: 'station',
  'station.setup': 'station',
  'auth.login': 'station',
  'auth.logout': 'signed-in',
  me: 'signed-in',
  'prefs.save': 'signed-in',
  'serials.register': 'station',
  'scans.recent': 'station',
  'scans.history': 'admin',
  'companies.active': 'station',
  'companies.all': 'admin',
  'companies.create': 'admin',
  'companies.update': 'admin',
  'users.list': 'admin',
  'users.create': 'admin',
  'users.setPassword': 'admin',
  'users.change': 'admin',
  counts: 'admin',
  'import.preview': 'admin',
  'import.confirm': 'admin',
  'import.history': 'admin',
  'import.details': 'admin',
  'serials.search': 'admin',
  'labels.reprint': 'admin',
  'export.data': 'admin',
  'export.record': 'admin',
  'export.history': 'admin',
  'nodes.list': 'admin',
  'nodes.revoke': 'admin',
  'nodes.update': 'admin',
  'settings.get': 'admin',
  'settings.set': 'admin',
  'cluster.status': 'admin',
  'cluster.setBackup': 'admin',
  'cluster.registerBackup': 'station',
  'cluster.stepDown': 'station',
  'cluster.handover': 'admin',
  'cluster.clearConflicts': 'admin',
  'auth.recover': 'station',
  'recovery.regenerate': 'admin-local',
  'pairing.open': 'admin-local',
  'pairing.status': 'admin-local',
  'pairing.close': 'admin-local',
};

/** Server -> station live events (WebSocket). */
export type ServerEvent =
  /** A scan was registered (new or duplicate) on any station: refresh the history strip. */
  | { type: 'scan'; scan: ScanLog }
  /** A user account changed (role/active/preferences): the affected person re-reads their profile. */
  | { type: 'user-changed'; uid: string }
  /** This station's session ended (signed out elsewhere, deactivated, or expired). */
  | { type: 'session-ended' }
  /** A station's name or usual operator changed (that station updates its header). */
  | { type: 'station-changed'; nodeId: string }
  /** Backup chosen/changed, a promotion, or the backup went online/offline: re-read the cluster. */
  | { type: 'cluster-changed' }
  /** The backup's full copy advanced (admin screens show the percentage). */
  | { type: 'backup-progress' };

/** Pairing (before the station has a credential). The 6-digit code is never part of any message. */
export interface PairStartResponse {
  sessionId: string;
  serverId: string;
  /** SRP-6a salt and server public value (hex). */
  salt: string;
  B: string;
}
export interface PairFinishRequest {
  sessionId: string;
  /** Optional: the name is set on the station setup screen right after pairing. */
  nodeName?: string;
  appVersion: string;
  /** SRP-6a client public value and proof (hex). */
  A: string;
  M1: string;
}
export interface PairFinishResponse {
  /** SRP-6a server proof (hex): shows the server knows the same code. */
  M2: string;
  /** AES-256-GCM, key derived from the SRP session key: the station credential + server cert. */
  iv: string;
  ciphertext: string;
  tag: string;
}
/** Plaintext of PairFinishResponse.ciphertext. */
export interface PairSecret {
  nodeId: string;
  nodeToken: string;
  serverId: string;
  certPem: string;
}
