/**
 * THE database module. Everything the server stores goes through `Store`; SQL exists only in this
 * file. `SqliteStore` is the implementation (one file, WAL mode). A PostgreSQL implementation can
 * replace it by implementing the same interface (all methods are already async).
 *
 * Duplicate safety: `serials` has UNIQUE(company_id, serial). Registration is ONE transaction:
 * insert-if-absent on that index, then the scan_log row. SQLite serialises write transactions, so
 * two stations sending the same serial at the same instant get exactly one 'new' and one
 * 'duplicate'. Every lookup goes through an index (see tests/store.test.ts, EXPLAIN QUERY PLAN).
 *
 * scan_log is the Scan History. `kind` says what a row is: 'scan' (a station registered or checked a
 * serial; result new/duplicate), 'import' (added by an Excel import) or 'reprint' (an administrator
 * printed an existing serial's label again). Import and reprint rows store result 'new' (the
 * column's CHECK allows only new/duplicate); `kind` is what tells them apart.
 */
import Database from 'better-sqlite3';
import type {
  Company,
  CodeType,
  ExportHistoryEntry,
  ImportHistoryEntry,
  ImportItem,
  ImportItemOutcome,
  Language,
  ScanLog,
  ScanLogKind,
  ScanResult,
  SerialRecord,
  SerialSource,
  Theme,
  User,
  UserRole,
} from '../../../web/src/types';
import type {
  HandoverConflict,
  HandoverRecords,
  HandoverResult,
  PairedNode,
  WireExportSerial,
  WireHistoryFilters,
} from '../../../web/src/desktop/protocol';

/** Stored user incl. the password hash (never leaves the server). */
export interface StoredUser extends User {
  passwordHash: string;
}

export interface Actor {
  uid: string;
  name: string;
}

export interface Station {
  id: string;
  name: string;
}

export interface NewCompany {
  id: string;
  name: string;
  codeType: CodeType;
  serialFormat: string;
  active: boolean;
  labelSize: { widthMm: number; heightMm: number } | null;
}

export interface RegisterRequest {
  serial: string;
  partNo: string;
  company: { id: string; name: string };
  source: SerialSource;
  actor: Actor;
  station: Station;
  now: string;
}

export type RegisterOutcome =
  | { result: 'new'; record: SerialRecord; log: ScanLog }
  | { result: 'duplicate'; existing: SerialRecord; log: ScanLog };

export interface NodeRecord extends PairedNode {
  revoked: boolean;
}

/** An administrator's sign-in. `expiresAt` slides forward on every use (inactivity timeout). */
export interface SessionRecord {
  userId: string;
  nodeId: string;
  expiresAt: string;
}

export interface ImportRowToCreate {
  serial: string;
  partNo: string;
  companyId: string;
  companyName: string;
}

export interface Store {
  close(): void;

  // meta
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  // users
  countUsers(): Promise<number>;
  createUser(u: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    passwordHash: string;
    now: string;
  }): Promise<void>;
  getUserById(id: string): Promise<StoredUser | null>;
  getUserByEmail(email: string): Promise<StoredUser | null>;
  listUsers(): Promise<User[]>;
  updateUserRoleActive(
    id: string,
    change: { role?: UserRole; active?: boolean },
    by: Actor,
    now: string,
  ): Promise<void>;
  setUserPassword(id: string, passwordHash: string, by: Actor, now: string): Promise<void>;
  setUserPreferences(id: string, language: Language, theme: Theme): Promise<void>;

  // sessions
  createSession(tokenHash: string, s: SessionRecord & { createdAt: string }): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  extendSession(tokenHash: string, expiresAt: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsForUser(userId: string): Promise<void>;
  deleteSessionsForNode(nodeId: string): Promise<void>;
  deleteExpiredSessions(now: string): Promise<void>;

  // stations (nodes)
  createNode(n: {
    id: string;
    name: string;
    tokenHash: string;
    appVersion: string;
    isServer: boolean;
    now: string;
  }): Promise<void>;
  getNodeByTokenHash(tokenHash: string): Promise<NodeRecord | null>;
  listNodes(): Promise<PairedNode[]>;
  touchNode(id: string, appVersion: string, now: string): Promise<void>;
  revokeNode(id: string, now: string): Promise<boolean>;
  /** Sets a station's name and usual operator and marks it set up; false if unknown or removed. */
  updateNode(id: string, profile: { name: string; operatorName: string }): Promise<boolean>;

  // companies
  listCompanies(activeOnly: boolean): Promise<Company[]>;
  getCompany(id: string): Promise<Company | null>;
  createCompany(c: NewCompany, by: Actor, now: string): Promise<boolean>;
  updateCompany(id: string, c: Omit<NewCompany, 'id'>, by: Actor, now: string): Promise<void>;

  // serials
  registerSerial(req: RegisterRequest): Promise<RegisterOutcome>;
  findSerials(keys: { companyId: string; serial: string }[]): Promise<SerialRecord[]>;
  recentScans(count: number): Promise<ScanLog[]>;
  scanHistory(
    filters: WireHistoryFilters,
    after: number | null,
    pageSize: number,
  ): Promise<{ entries: (ScanLog & { seq: number })[]; hasMore: boolean }>;
  /** Search by serial: exact or starting with `prefix` (already normalised), max `limit`. */
  searchSerials(prefix: string, limit: number): Promise<SerialRecord[]>;
  /** Logs an administrator's label reprint in the Scan History. */
  logReprint(record: SerialRecord, actor: Actor, station: Station, now: string): Promise<ScanLog>;
  importSerials(
    rows: ImportRowToCreate[],
    actor: Actor,
    station: Station,
    now: string,
    /** The import's history row: added serials point to it, and are listed as "Imported". */
    importId?: number | null,
  ): Promise<{ created: number; existing: SerialRecord[] }>;
  allSerialsForExport(): Promise<WireExportSerial[]>;

  // counts
  countSerials(): Promise<number>;
  countSerialsForCompany(companyId: string): Promise<number>;
  countSerialsBetween(start: string, end: string): Promise<number>;
  countDuplicatesBetween(start: string, end: string): Promise<number>;
  countCompanies(activeOnly: boolean): Promise<number>;
  countActiveOperators(): Promise<number>;

  // audit
  addImportHistory(e: Omit<ImportHistoryEntry, 'id'>): Promise<void>;
  /** An import in progress: its history row (finished by `finishImport`), returns its id. */
  startImport(e: { filename: string; by: Actor; at: string }): Promise<number>;
  finishImport(
    id: number,
    e: Omit<ImportHistoryEntry, 'id' | 'filename' | 'importedBy' | 'importedByName' | 'importedAt'>,
    items: ImportItem[],
  ): Promise<void>;
  /** null = no such import; `recorded` false for imports made before details were kept. */
  importDetails(
    id: number,
  ): Promise<{ filename: string; recorded: boolean; items: ImportItem[] } | null>;
  importHistory(count: number): Promise<ImportHistoryEntry[]>;
  addExportHistory(e: Omit<ExportHistoryEntry, 'id'>): Promise<void>;
  exportHistory(count: number): Promise<ExportHistoryEntry[]>;

  // ---- this computer only (never copied to the backup) ----
  getLocal(key: string): Promise<string | null>;
  setLocal(key: string, value: string): Promise<void>;
  /** Makes `nodeId` the main computer's own window (after a promotion). */
  setServerNode(nodeId: string): Promise<void>;

  // ---- backup main computer ----
  /** Highest change number written so far (see repl_log). */
  replLastSeq(): number;
  /** Adds what a former main computer had that is missing here; conflicts are kept for the admin. */
  mergeHandover(records: HandoverRecords, now: string): Promise<HandoverResult>;
  listConflicts(): Promise<HandoverConflict[]>;
  clearConflicts(): Promise<void>;
}

/** Tables copied to the backup main computer (everything except sessions and local state). */
export const REPLICATED_TABLES = [
  'meta',
  'users',
  'nodes',
  'companies',
  'serials',
  'scan_log',
  'import_history',
  'import_items',
  'export_history',
  'handover_conflicts',
] as const;
export type ReplicatedTable = (typeof REPLICATED_TABLES)[number];

/** One change: the row's full new contents ('u'), or its removal ('d'). */
export interface ReplEntry {
  seq: number;
  tbl: ReplicatedTable;
  op: 'u' | 'd';
  rid: number;
  data: Record<string, unknown> | null;
}

export interface ReplSnapshot {
  seq: number;
  tables: Partial<Record<ReplicatedTable, Record<string, unknown>[]>>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'admin')),
  active INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  language TEXT,
  theme TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  updated_by_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS users_role_active ON users (role, active);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  app_version TEXT NOT NULL,
  is_server INTEGER NOT NULL DEFAULT 0,
  paired_at TEXT NOT NULL,
  last_seen TEXT,
  revoked_at TEXT,
  operator_name TEXT NOT NULL DEFAULT '',
  configured INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_node ON sessions (node_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code_type TEXT NOT NULL CHECK (code_type IN ('barcode', 'qr')),
  serial_format TEXT NOT NULL,
  label_width_mm REAL,
  label_height_mm REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT,
  updated_by_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS companies_active ON companies (active);
CREATE TABLE IF NOT EXISTS serials (
  id INTEGER PRIMARY KEY,
  company_id TEXT NOT NULL,
  serial TEXT NOT NULL,
  part_no TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('excel', 'manual', 'scan')),
  scanned_at TEXT NOT NULL,
  scanned_by TEXT NOT NULL,
  scanned_by_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  import_id INTEGER,
  UNIQUE (company_id, serial)
);
CREATE INDEX IF NOT EXISTS serials_scanned_at ON serials (scanned_at);
CREATE INDEX IF NOT EXISTS serials_serial ON serials (serial);
CREATE TABLE IF NOT EXISTS scan_log (
  id INTEGER PRIMARY KEY,
  serial TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('new', 'duplicate')),
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  source TEXT NOT NULL,
  scanned_by TEXT NOT NULL,
  scanned_by_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'scan' CHECK (kind IN ('scan', 'import', 'reprint'))
);
CREATE INDEX IF NOT EXISTS scan_log_time ON scan_log (timestamp);
CREATE INDEX IF NOT EXISTS scan_log_result_time ON scan_log (result, timestamp);
CREATE INDEX IF NOT EXISTS scan_log_company ON scan_log (company_id, id);
CREATE INDEX IF NOT EXISTS scan_log_operator ON scan_log (scanned_by, id);
CREATE INDEX IF NOT EXISTS scan_log_source ON scan_log (source, id);
CREATE INDEX IF NOT EXISTS scan_log_result ON scan_log (result, id);
CREATE TABLE IF NOT EXISTS import_history (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  imported_by_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  skipped INTEGER NOT NULL,
  conflicts INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  invalid INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS import_items (
  import_id INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  sheet TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL,
  company_name TEXT NOT NULL,
  part_no TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('added', 'skipped', 'conflict', 'duplicate', 'invalid')),
  reason TEXT NOT NULL DEFAULT '',
  reason_msg TEXT
);
CREATE INDEX IF NOT EXISTS import_items_import ON import_items (import_id, row_number);
CREATE TABLE IF NOT EXISTS handover_conflicts (
  id INTEGER PRIMARY KEY,
  serial TEXT NOT NULL,
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  part_no TEXT NOT NULL,
  node_name TEXT NOT NULL,
  scanned_at TEXT,
  other_part_no TEXT NOT NULL,
  other_node_name TEXT NOT NULL,
  other_scanned_at TEXT,
  reported_at TEXT NOT NULL,
  UNIQUE (company_id, serial)
);
CREATE TABLE IF NOT EXISTS local (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repl_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  op TEXT NOT NULL,
  rid INTEGER NOT NULL,
  data TEXT
);
CREATE TABLE IF NOT EXISTS export_history (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  exported_by TEXT NOT NULL,
  exported_by_name TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  record_count INTEGER NOT NULL
);
`;

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

function toUser(r: Row): StoredUser {
  const language = r.language;
  const theme = r.theme;
  return {
    uid: str(r.id),
    email: str(r.email),
    name: str(r.name),
    role: r.role === 'admin' ? 'admin' : 'operator',
    active: r.active === 1,
    createdAt: strOrNull(r.created_at),
    updatedAt: strOrNull(r.updated_at),
    updatedByName: str(r.updated_by_name),
    preferences: {
      ...(language === 'en' || language === 'hi' || language === 'mr' ? { language } : {}),
      ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
    },
    passwordHash: str(r.password_hash),
  };
}

function publicUser(u: StoredUser): User {
  const { passwordHash: _hidden, ...rest } = u;
  void _hidden;
  return rest;
}

function toCompany(r: Row): Company {
  const w = r.label_width_mm;
  const h = r.label_height_mm;
  return {
    id: str(r.id),
    name: str(r.name),
    codeType: r.code_type === 'barcode' || r.code_type === 'qr' ? r.code_type : null,
    serialFormat: str(r.serial_format),
    active: r.active === 1,
    createdAt: strOrNull(r.created_at),
    updatedAt: strOrNull(r.updated_at),
    updatedByName: str(r.updated_by_name),
    ...(typeof w === 'number' && typeof h === 'number'
      ? { labelSize: { widthMm: w, heightMm: h } }
      : {}),
  };
}

function toSerial(r: Row): SerialRecord {
  return {
    serial: str(r.serial),
    partNo: str(r.part_no),
    company: str(r.company_name),
    companyId: str(r.company_id),
    source: r.source as SerialSource,
    scannedAt: strOrNull(r.scanned_at),
    scannedBy: str(r.scanned_by),
    scannedByName: str(r.scanned_by_name),
    nodeName: str(r.node_name),
    ...(typeof r.import_file === 'string' ? { importFile: r.import_file } : {}),
  };
}

function toLog(r: Row): ScanLog & { seq: number } {
  return {
    id: String(r.id),
    seq: num(r.id),
    serial: str(r.serial),
    result: r.result as ScanResult,
    company: str(r.company_name),
    companyId: str(r.company_id),
    source: r.source as SerialSource,
    scannedBy: str(r.scanned_by),
    scannedByName: str(r.scanned_by_name),
    timestamp: strOrNull(r.timestamp),
    nodeName: str(r.node_name),
    kind: (r.kind === 'import' || r.kind === 'reprint' ? r.kind : 'scan') as ScanLogKind,
  };
}

const ITEM_OUTCOMES: readonly ImportItemOutcome[] = [
  'added',
  'skipped',
  'conflict',
  'duplicate',
  'invalid',
];

function toItem(r: Row): ImportItem {
  let reasonMsg: ImportItem['reasonMsg'];
  if (typeof r.reason_msg === 'string') {
    try {
      reasonMsg = JSON.parse(r.reason_msg) as ImportItem['reasonMsg'];
    } catch {
      reasonMsg = undefined;
    }
  }
  const outcome = ITEM_OUTCOMES.find((o) => o === r.outcome) ?? 'invalid';
  return {
    rowNumber: num(r.row_number),
    sheet: str(r.sheet),
    serial: str(r.serial),
    companyName: str(r.company_name),
    partNo: str(r.part_no),
    outcome,
    reason: str(r.reason),
    ...(reasonMsg ? { reasonMsg } : {}),
  };
}

/** A serial with the name of the file it was imported from (if any). */
const SERIAL_WITH_FILE = `SELECT s.*, ih.filename AS import_file FROM serials s
  LEFT JOIN import_history ih ON ih.id = s.import_id`;

function toNode(r: Row): NodeRecord {
  return {
    id: str(r.id),
    name: str(r.name),
    pairedAt: str(r.paired_at),
    lastSeen: strOrNull(r.last_seen),
    appVersion: str(r.app_version),
    isServer: r.is_server === 1,
    revoked: r.revoked_at !== null && r.revoked_at !== undefined,
    operatorName: str(r.operator_name),
    configured: r.configured === 1,
  };
}

/**
 * Databases from earlier versions: add the station columns (stations that already existed were
 * named at pairing, so they count as set up). Existing records are never changed.
 */
function migrate(db: Database.Database) {
  const columns = (table: string) =>
    new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    );
  const nodes = columns('nodes');
  const serials = columns('serials');
  const scanLog = columns('scan_log');
  db.transaction(() => {
    if (!serials.has('import_id')) db.exec('ALTER TABLE serials ADD COLUMN import_id INTEGER');
    if (!scanLog.has('kind')) {
      // Every existing history row is a station scan.
      db.exec(
        `ALTER TABLE scan_log ADD COLUMN kind TEXT NOT NULL DEFAULT 'scan'
           CHECK (kind IN ('scan', 'import', 'reprint'))`,
      );
    }
    db.exec('CREATE INDEX IF NOT EXISTS scan_log_kind ON scan_log (kind, id)');
    if (!nodes.has('operator_name')) {
      db.exec(`ALTER TABLE nodes ADD COLUMN operator_name TEXT NOT NULL DEFAULT ''`);
    }
    if (!nodes.has('configured')) {
      db.exec('ALTER TABLE nodes ADD COLUMN configured INTEGER NOT NULL DEFAULT 0');
      db.exec('UPDATE nodes SET configured = 1');
    }
  })();
}

/**
 * Change capture for the backup: triggers write every insert/update/delete of a replicated table
 * into repl_log in the SAME transaction, so no write can happen without being recorded. Recreated
 * on every start, so columns added by later versions are always included.
 */
function installChangeCapture(db: Database.Database) {
  for (const t of REPLICATED_TABLES) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    const row = `json_object(${cols.map((c) => `'${c}', NEW.${c}`).join(', ')})`;
    db.exec(`
      DROP TRIGGER IF EXISTS repl_${t}_ins;
      DROP TRIGGER IF EXISTS repl_${t}_upd;
      DROP TRIGGER IF EXISTS repl_${t}_del;
      CREATE TRIGGER repl_${t}_ins AFTER INSERT ON ${t} WHEN repl_enabled() BEGIN
        INSERT INTO repl_log (tbl, op, rid, data) VALUES ('${t}', 'u', NEW.rowid, ${row});
      END;
      CREATE TRIGGER repl_${t}_upd AFTER UPDATE ON ${t} WHEN repl_enabled() BEGIN
        INSERT INTO repl_log (tbl, op, rid, data) VALUES ('${t}', 'u', NEW.rowid, ${row});
      END;
      CREATE TRIGGER repl_${t}_del AFTER DELETE ON ${t} WHEN repl_enabled() BEGIN
        INSERT INTO repl_log (tbl, op, rid, data) VALUES ('${t}', 'd', OLD.rowid, NULL);
      END;
    `);
  }
}

const isReplicated = (t: unknown): t is ReplicatedTable =>
  (REPLICATED_TABLES as readonly unknown[]).includes(t);

export class SqliteStore implements Store {
  readonly db: Database.Database;
  /** Off while the backup applies changes from the main computer (they are not new changes). */
  private capture = true;
  private readonly columns = new Map<string, Set<string>>();

  /** `file` = path of the database file, or ':memory:' (tests). */
  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL'); // a registration is on disk before "new" is shown
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.function('repl_enabled', { deterministic: false }, () => (this.capture ? 1 : 0));
    this.db.exec(SCHEMA);
    migrate(this.db);
    installChangeCapture(this.db);
    for (const t of REPLICATED_TABLES) {
      this.columns.set(
        t,
        new Set(
          (this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(
            (c) => c.name,
          ),
        ),
      );
    }
  }

  close() {
    this.db.close();
  }

  private one(sql: string, ...args: unknown[]): Row | undefined {
    return this.db.prepare(sql).get(...args) as Row | undefined;
  }
  private all(sql: string, ...args: unknown[]): Row[] {
    return this.db.prepare(sql).all(...args) as Row[];
  }
  private run(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).run(...args);
  }
  private count(sql: string, ...args: unknown[]): number {
    return num(this.one(sql, ...args)?.n);
  }

  // ---- meta ----
  async getMeta(key: string) {
    return strOrNull(this.one('SELECT value FROM meta WHERE key = ?', key)?.value);
  }
  async setMeta(key: string, value: string) {
    this.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  // ---- users ----
  async countUsers() {
    return this.count('SELECT COUNT(*) AS n FROM users');
  }
  async createUser(u: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    passwordHash: string;
    now: string;
  }) {
    this.run(
      `INSERT INTO users (id, email, name, role, active, password_hash, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      u.id,
      u.email,
      u.name,
      u.role,
      u.passwordHash,
      u.now,
    );
  }
  async getUserById(id: string) {
    const r = this.one('SELECT * FROM users WHERE id = ?', id);
    return r ? toUser(r) : null;
  }
  async getUserByEmail(email: string) {
    const r = this.one('SELECT * FROM users WHERE email = ?', email);
    return r ? toUser(r) : null;
  }
  async listUsers() {
    return this.all('SELECT * FROM users ORDER BY name COLLATE NOCASE, email').map((r) =>
      publicUser(toUser(r)),
    );
  }
  async updateUserRoleActive(
    id: string,
    change: { role?: UserRole; active?: boolean },
    by: Actor,
    now: string,
  ) {
    this.run(
      `UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active),
         updated_at = ?, updated_by_name = ? WHERE id = ?`,
      change.role ?? null,
      change.active === undefined ? null : change.active ? 1 : 0,
      now,
      by.name,
      id,
    );
  }
  async setUserPassword(id: string, passwordHash: string, by: Actor, now: string) {
    this.run(
      'UPDATE users SET password_hash = ?, updated_at = ?, updated_by_name = ? WHERE id = ?',
      passwordHash,
      now,
      by.name,
      id,
    );
  }
  async setUserPreferences(id: string, language: Language, theme: Theme) {
    this.run('UPDATE users SET language = ?, theme = ? WHERE id = ?', language, theme, id);
  }

  // ---- sessions ----
  async createSession(tokenHash: string, s: SessionRecord & { createdAt: string }) {
    this.run(
      'INSERT INTO sessions (token_hash, user_id, node_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      tokenHash,
      s.userId,
      s.nodeId,
      s.createdAt,
      s.expiresAt,
    );
  }
  async getSession(tokenHash: string) {
    const r = this.one('SELECT * FROM sessions WHERE token_hash = ?', tokenHash);
    return r
      ? { userId: str(r.user_id), nodeId: str(r.node_id), expiresAt: str(r.expires_at) }
      : null;
  }
  async extendSession(tokenHash: string, expiresAt: string) {
    this.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', expiresAt, tokenHash);
  }
  async deleteSession(tokenHash: string) {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }
  async deleteSessionsForUser(userId: string) {
    this.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }
  async deleteSessionsForNode(nodeId: string) {
    this.run('DELETE FROM sessions WHERE node_id = ?', nodeId);
  }
  async deleteExpiredSessions(now: string) {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
  }

  // ---- stations ----
  async createNode(n: {
    id: string;
    name: string;
    tokenHash: string;
    appVersion: string;
    isServer: boolean;
    now: string;
  }) {
    // Only one credential for the server's own window: a new one retires the previous one.
    if (n.isServer) {
      this.run('UPDATE nodes SET revoked_at = ? WHERE is_server = 1 AND revoked_at IS NULL', n.now);
    }
    this.run(
      `INSERT INTO nodes (id, name, token_hash, app_version, is_server, paired_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      n.id,
      n.name,
      n.tokenHash,
      n.appVersion,
      n.isServer ? 1 : 0,
      n.now,
      n.now,
    );
  }
  async getNodeByTokenHash(tokenHash: string) {
    const r = this.one('SELECT * FROM nodes WHERE token_hash = ?', tokenHash);
    return r ? toNode(r) : null;
  }
  async listNodes() {
    return this.all(
      'SELECT * FROM nodes WHERE revoked_at IS NULL ORDER BY is_server DESC, name COLLATE NOCASE',
    ).map((r) => {
      const { revoked: _r, ...node } = toNode(r);
      void _r;
      return node;
    });
  }
  async touchNode(id: string, appVersion: string, now: string) {
    this.run('UPDATE nodes SET last_seen = ?, app_version = ? WHERE id = ?', now, appVersion, id);
  }
  async updateNode(id: string, profile: { name: string; operatorName: string }) {
    const r = this.run(
      'UPDATE nodes SET name = ?, operator_name = ?, configured = 1 WHERE id = ? AND revoked_at IS NULL',
      profile.name,
      profile.operatorName,
      id,
    );
    return r.changes === 1;
  }
  async revokeNode(id: string, now: string) {
    const r = this.run(
      'UPDATE nodes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND is_server = 0',
      now,
      id,
    );
    return r.changes === 1;
  }

  // ---- companies ----
  async listCompanies(activeOnly: boolean) {
    const rows = activeOnly
      ? this.all('SELECT * FROM companies WHERE active = 1')
      : this.all('SELECT * FROM companies');
    return rows.map(toCompany).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getCompany(id: string) {
    const r = this.one('SELECT * FROM companies WHERE id = ?', id);
    return r ? toCompany(r) : null;
  }
  async createCompany(c: NewCompany, by: Actor, now: string) {
    const r = this.run(
      `INSERT INTO companies (id, name, code_type, serial_format, label_width_mm, label_height_mm,
         active, created_at, created_by, updated_at, updated_by, updated_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      c.id,
      c.name,
      c.codeType,
      c.serialFormat,
      c.labelSize?.widthMm ?? null,
      c.labelSize?.heightMm ?? null,
      c.active ? 1 : 0,
      now,
      by.uid,
      now,
      by.uid,
      by.name,
    );
    return r.changes === 1;
  }
  async updateCompany(id: string, c: Omit<NewCompany, 'id'>, by: Actor, now: string) {
    this.run(
      `UPDATE companies SET name = ?, code_type = ?, serial_format = ?, label_width_mm = ?,
         label_height_mm = ?, active = ?, updated_at = ?, updated_by = ?, updated_by_name = ?
       WHERE id = ?`,
      c.name,
      c.codeType,
      c.serialFormat,
      c.labelSize?.widthMm ?? null,
      c.labelSize?.heightMm ?? null,
      c.active ? 1 : 0,
      now,
      by.uid,
      by.name,
      id,
    );
  }

  // ---- serials ----
  async registerSerial(req: RegisterRequest): Promise<RegisterOutcome> {
    return this.registerTx(req);
  }

  /** The atomic registration: one write transaction (IMMEDIATE = takes the write lock first). */
  private readonly registerTx = (req: RegisterRequest): RegisterOutcome => {
    const tx = this.db.transaction((r: RegisterRequest): RegisterOutcome => {
      const inserted = this.db
        .prepare(
          `INSERT INTO serials (company_id, serial, part_no, company_name, source, scanned_at,
             scanned_by, scanned_by_name, node_id, node_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(company_id, serial) DO NOTHING`,
        )
        .run(
          r.company.id,
          r.serial,
          r.partNo,
          r.company.name,
          r.source,
          r.now,
          r.actor.uid,
          r.actor.name,
          r.station.id,
          r.station.name,
        );
      const isNew = inserted.changes === 1;
      const log = this.db
        .prepare(
          `INSERT INTO scan_log (serial, result, company_id, company_name, source, scanned_by,
             scanned_by_name, node_id, node_name, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          r.serial,
          isNew ? 'new' : 'duplicate',
          r.company.id,
          r.company.name,
          r.source,
          r.actor.uid,
          r.actor.name,
          r.station.id,
          r.station.name,
          r.now,
        );
      const { seq: _seq, ...logRow } = toLog(
        this.one('SELECT * FROM scan_log WHERE id = ?', log.lastInsertRowid) as Row,
      );
      void _seq;
      const serialRow = toSerial(
        this.one(
          'SELECT * FROM serials WHERE company_id = ? AND serial = ?',
          r.company.id,
          r.serial,
        ) as Row,
      );
      return isNew
        ? { result: 'new', record: serialRow, log: logRow }
        : { result: 'duplicate', existing: serialRow, log: logRow };
    });
    return tx.immediate(req);
  };

  async findSerials(keys: { companyId: string; serial: string }[]) {
    const stmt = this.db.prepare(`${SERIAL_WITH_FILE} WHERE s.company_id = ? AND s.serial = ?`);
    const out: SerialRecord[] = [];
    for (const k of keys) {
      const r = stmt.get(k.companyId, k.serial) as Row | undefined;
      if (r) out.push(toSerial(r));
    }
    return out;
  }

  async recentScans(count: number) {
    // Station scans only: imports and reprints are in the admin Scan History, not the scan strip.
    const rows = this.all(
      `SELECT * FROM scan_log WHERE kind = 'scan' ORDER BY id DESC LIMIT ?`,
      count,
    );
    return rows.map((r) => {
      const { seq: _seq, ...log } = toLog(r);
      void _seq;
      return log;
    });
  }

  async scanHistory(filters: WireHistoryFilters, after: number | null, pageSize: number) {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      where.push(clause);
      args.push(value);
    };
    if (filters.kind === 'scan' || filters.kind === 'import' || filters.kind === 'reprint') {
      add('kind = ?', filters.kind);
    }
    if (filters.result) {
      // New / duplicate are station scans (imports and reprints have their own kinds).
      add('result = ?', filters.result);
      if (!filters.kind) add('kind = ?', 'scan');
    }
    if (filters.companyId) add('company_id = ?', filters.companyId);
    if (filters.source) add('source = ?', filters.source);
    if (filters.scannedBy) add('scanned_by = ?', filters.scannedBy);
    if (filters.from) add('timestamp >= ?', filters.from);
    if (filters.to) add('timestamp < ?', filters.to);
    if (after !== null) add('id < ?', after);
    const sql = `SELECT * FROM scan_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY id DESC LIMIT ?`;
    const rows = this.all(sql, ...args, pageSize + 1).map(toLog);
    return { entries: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
  }

  async searchSerials(prefix: string, limit: number) {
    if (!prefix) return [];
    // Range on the serial index: exact match first, then serials starting with `prefix`.
    return this.all(
      `${SERIAL_WITH_FILE} WHERE s.serial >= ? AND s.serial < ?
       ORDER BY s.serial = ? DESC, s.serial, s.company_name LIMIT ?`,
      prefix,
      `${prefix}\uffff`,
      prefix,
      limit,
    ).map(toSerial);
  }

  async logReprint(record: SerialRecord, actor: Actor, station: Station, now: string) {
    const res = this.run(
      `INSERT INTO scan_log (serial, result, company_id, company_name, source, scanned_by,
         scanned_by_name, node_id, node_name, timestamp, kind)
       VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, 'reprint')`,
      record.serial,
      record.companyId,
      record.company,
      record.source,
      actor.uid,
      actor.name,
      station.id,
      station.name,
      now,
    );
    const { seq: _seq, ...log } = toLog(
      this.one('SELECT * FROM scan_log WHERE id = ?', res.lastInsertRowid) as Row,
    );
    void _seq;
    return log;
  }

  async importSerials(
    rows: ImportRowToCreate[],
    actor: Actor,
    station: Station,
    now: string,
    importId: number | null = null,
  ) {
    const insert = this.db.prepare(
      `INSERT INTO serials (company_id, serial, part_no, company_name, source, scanned_at,
         scanned_by, scanned_by_name, node_id, node_name, import_id)
       VALUES (?, ?, ?, ?, 'excel', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, serial) DO NOTHING`,
    );
    // Each added serial is listed in the Scan History as "Imported".
    const log = this.db.prepare(
      `INSERT INTO scan_log (serial, result, company_id, company_name, source, scanned_by,
         scanned_by_name, node_id, node_name, timestamp, kind)
       VALUES (?, 'new', ?, ?, 'excel', ?, ?, ?, ?, ?, 'import')`,
    );
    const find = this.db.prepare('SELECT * FROM serials WHERE company_id = ? AND serial = ?');
    // One transaction for the whole import: either every new row is written or none is.
    // Rows registered by someone else since the preview are never overwritten (ON CONFLICT).
    const tx = this.db.transaction(() => {
      let created = 0;
      const existing: SerialRecord[] = [];
      for (const r of rows) {
        const res = insert.run(
          r.companyId,
          r.serial,
          r.partNo,
          r.companyName,
          now,
          actor.uid,
          actor.name,
          station.id,
          station.name,
          importId,
        );
        if (res.changes === 1) {
          created++;
          log.run(
            r.serial,
            r.companyId,
            r.companyName,
            actor.uid,
            actor.name,
            station.id,
            station.name,
            now,
          );
        } else existing.push(toSerial(find.get(r.companyId, r.serial) as Row));
      }
      return { created, existing };
    });
    return tx.immediate();
  }

  async allSerialsForExport(): Promise<WireExportSerial[]> {
    return this.all('SELECT * FROM serials ORDER BY id').map((r) => ({
      serial: str(r.serial),
      partNo: str(r.part_no),
      company: str(r.company_name),
      companyId: str(r.company_id),
      source: str(r.source),
      scannedAt: strOrNull(r.scanned_at),
      scannedByName: str(r.scanned_by_name),
      nodeName: str(r.node_name),
    }));
  }

  // ---- counts ----
  async countSerials() {
    return this.count('SELECT COUNT(*) AS n FROM serials');
  }
  async countSerialsForCompany(companyId: string) {
    return this.count('SELECT COUNT(*) AS n FROM serials WHERE company_id = ?', companyId);
  }
  async countSerialsBetween(start: string, end: string) {
    return this.count(
      'SELECT COUNT(*) AS n FROM serials WHERE scanned_at >= ? AND scanned_at < ?',
      start,
      end,
    );
  }
  async countDuplicatesBetween(start: string, end: string) {
    return this.count(
      `SELECT COUNT(*) AS n FROM scan_log WHERE result = 'duplicate' AND timestamp >= ? AND timestamp < ?`,
      start,
      end,
    );
  }
  async countCompanies(activeOnly: boolean) {
    return activeOnly
      ? this.count('SELECT COUNT(*) AS n FROM companies WHERE active = 1')
      : this.count('SELECT COUNT(*) AS n FROM companies');
  }
  async countActiveOperators() {
    return this.count(`SELECT COUNT(*) AS n FROM users WHERE role = 'operator' AND active = 1`);
  }

  // ---- audit ----
  async addImportHistory(e: Omit<ImportHistoryEntry, 'id'>) {
    this.run(
      `INSERT INTO import_history (filename, imported_by, imported_by_name, imported_at, total_rows,
         new_count, skipped, conflicts, duplicates, invalid, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.filename,
      e.importedBy,
      e.importedByName,
      e.importedAt,
      e.totalRows,
      e.newCount,
      e.skipped,
      e.conflicts,
      e.duplicates,
      e.invalid,
      e.status,
      e.error,
    );
  }
  async startImport(e: { filename: string; by: Actor; at: string }) {
    // 'failed' until finished: an import interrupted before `finishImport` is not shown as done.
    const res = this.run(
      `INSERT INTO import_history (filename, imported_by, imported_by_name, imported_at, total_rows,
         new_count, skipped, conflicts, duplicates, invalid, status, error)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 'failed', '')`,
      e.filename,
      e.by.uid,
      e.by.name,
      e.at,
    );
    return Number(res.lastInsertRowid);
  }
  async finishImport(
    id: number,
    e: Omit<ImportHistoryEntry, 'id' | 'filename' | 'importedBy' | 'importedByName' | 'importedAt'>,
    items: ImportItem[],
  ) {
    const insert = this.db.prepare(
      `INSERT INTO import_items (import_id, row_number, sheet, serial, company_name, part_no,
         outcome, reason, reason_msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.run(
        `UPDATE import_history SET total_rows = ?, new_count = ?, skipped = ?, conflicts = ?,
           duplicates = ?, invalid = ?, status = ?, error = ? WHERE id = ?`,
        e.totalRows,
        e.newCount,
        e.skipped,
        e.conflicts,
        e.duplicates,
        e.invalid,
        e.status,
        e.error,
        id,
      );
      for (const it of items) {
        insert.run(
          id,
          it.rowNumber,
          it.sheet,
          it.serial,
          it.companyName,
          it.partNo,
          it.outcome,
          it.reason,
          it.reasonMsg ? JSON.stringify(it.reasonMsg) : null,
        );
      }
    })();
  }
  async importDetails(id: number) {
    const h = this.one('SELECT filename FROM import_history WHERE id = ?', id);
    if (!h) return null;
    const items = this.all(
      'SELECT * FROM import_items WHERE import_id = ? ORDER BY row_number, rowid',
      id,
    ).map(toItem);
    // Imports from before details were kept have no items and no serials linked to them.
    const recorded =
      items.length > 0 ||
      this.count('SELECT COUNT(*) AS n FROM serials WHERE import_id = ?', id) > 0;
    return { filename: str(h.filename), recorded, items };
  }
  async importHistory(count: number): Promise<ImportHistoryEntry[]> {
    return this.all('SELECT * FROM import_history ORDER BY id DESC LIMIT ?', count).map((r) => ({
      id: String(r.id),
      filename: str(r.filename),
      importedBy: str(r.imported_by),
      importedByName: str(r.imported_by_name),
      importedAt: strOrNull(r.imported_at),
      totalRows: num(r.total_rows),
      newCount: num(r.new_count),
      skipped: num(r.skipped),
      conflicts: num(r.conflicts),
      duplicates: num(r.duplicates),
      invalid: num(r.invalid),
      status: r.status === 'failed' ? 'failed' : 'completed',
      error: str(r.error),
    }));
  }
  async addExportHistory(e: Omit<ExportHistoryEntry, 'id'>) {
    this.run(
      `INSERT INTO export_history (filename, exported_by, exported_by_name, exported_at, record_count)
       VALUES (?, ?, ?, ?, ?)`,
      e.filename,
      e.exportedBy,
      e.exportedByName,
      e.exportedAt,
      e.recordCount,
    );
  }
  async exportHistory(count: number): Promise<ExportHistoryEntry[]> {
    return this.all('SELECT * FROM export_history ORDER BY id DESC LIMIT ?', count).map((r) => ({
      id: String(r.id),
      filename: str(r.filename),
      exportedBy: str(r.exported_by),
      exportedByName: str(r.exported_by_name),
      exportedAt: strOrNull(r.exported_at),
      recordCount: num(r.record_count),
    }));
  }

  // ---- this computer only ----
  async getLocal(key: string) {
    return strOrNull(this.one('SELECT value FROM local WHERE key = ?', key)?.value);
  }
  async setLocal(key: string, value: string) {
    this.run(
      'INSERT INTO local (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }
  async setServerNode(nodeId: string) {
    this.run('UPDATE nodes SET is_server = CASE WHEN id = ? THEN 1 ELSE 0 END', nodeId);
  }

  // ---- replication: main computer side ----
  replLastSeq(): number {
    // The AUTOINCREMENT counter: still right after old changes were pruned.
    return num(this.one(`SELECT seq AS n FROM sqlite_sequence WHERE name = 'repl_log'`)?.n);
  }
  /** Oldest change still kept (0 if none). */
  replOldestSeq(): number {
    return num(this.one('SELECT MIN(seq) AS n FROM repl_log')?.n);
  }
  replEntriesAfter(seq: number, limit: number): ReplEntry[] {
    return this.all('SELECT * FROM repl_log WHERE seq > ? ORDER BY seq LIMIT ?', seq, limit).map(
      (r) => ({
        seq: num(r.seq),
        tbl: r.tbl as ReplicatedTable,
        op: r.op === 'd' ? 'd' : 'u',
        rid: num(r.rid),
        data: typeof r.data === 'string' ? (JSON.parse(r.data) as Record<string, unknown>) : null,
      }),
    );
  }
  /** Drops changes the backup already has (and every change when there is no backup). */
  replPruneThrough(seq: number) {
    this.run('DELETE FROM repl_log WHERE seq <= ?', seq);
  }
  /** Every replicated row plus the change number it is consistent with (one read transaction). */
  replSnapshot(): ReplSnapshot {
    return this.db.transaction((): ReplSnapshot => {
      const tables: ReplSnapshot['tables'] = {};
      for (const t of REPLICATED_TABLES)
        tables[t] = this.all(`SELECT rowid AS __rowid, * FROM ${t}`);
      return { seq: this.replLastSeq(), tables };
    })();
  }

  // ---- replication: backup side ----
  private upsert(t: ReplicatedTable, rid: number, data: Record<string, unknown>) {
    const known = this.columns.get(t)!;
    const cols = Object.keys(data).filter((c) => known.has(c));
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${t} (rowid, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      )
      .run(rid, ...cols.map((c) => data[c] as string | number | null));
  }
  /**
   * The full copy arrives in pieces and is applied as it comes, so a backup whose main computer
   * stops half way still has what arrived (users and settings come first). It is marked complete
   * only when the last piece is in.
   */
  replBeginSnapshot() {
    this.withoutCapture(() =>
      this.db.transaction(() => {
        for (const t of REPLICATED_TABLES) this.run(`DELETE FROM ${t}`);
        this.setLocalSync('repl_complete', '0');
        this.setLocalSync('repl_seq', '0');
        this.setLocalSync('repl_source', '');
      })(),
    );
  }
  replApplyRows(t: string, rows: Record<string, unknown>[]) {
    if (!isReplicated(t)) throw new Error(`not a replicated table: ${t}`);
    this.withoutCapture(() =>
      this.db.transaction(() => {
        for (const { __rowid, ...row } of rows) this.upsert(t, num(__rowid), row);
      })(),
    );
  }
  replFinishSnapshot(seq: number, sourceId: string) {
    this.db.transaction(() => {
      this.setLocalSync('repl_seq', String(seq));
      this.setLocalSync('repl_source', sourceId);
      this.setLocalSync('repl_complete', '1');
    })();
  }
  /** Did this backup ever have a complete copy? (Copies from before this mark existed: yes.) */
  replEverComplete(): boolean {
    const mark = this.getLocalSync('repl_complete');
    return mark === null ? !!this.getLocalSync('repl_source') : mark === '1';
  }
  private withoutCapture<T>(fn: () => T): T {
    this.capture = false;
    try {
      return fn();
    } finally {
      this.capture = true;
    }
  }
  /** Applies changes in order (all or nothing); returns the change number reached. */
  replApply(entries: ReplEntry[]): number {
    this.capture = false;
    try {
      return this.db.transaction(() => {
        let seq = num(this.getLocalSync('repl_seq'));
        for (const e of entries) {
          if (e.seq <= seq) continue; // already applied
          if (!isReplicated(e.tbl)) throw new Error(`not a replicated table: ${String(e.tbl)}`);
          if (e.op === 'd') this.run(`DELETE FROM ${e.tbl} WHERE rowid = ?`, e.rid);
          else if (e.data) this.upsert(e.tbl, e.rid, e.data);
          seq = e.seq;
        }
        this.setLocalSync('repl_seq', String(seq));
        return seq;
      })();
    } finally {
      this.capture = true;
    }
  }
  getLocalSync(key: string) {
    return strOrNull(this.one('SELECT value FROM local WHERE key = ?', key)?.value);
  }
  setLocalSync(key: string, value: string) {
    this.run(
      'INSERT INTO local (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  // ---- hand-over from a former main computer ----
  /**
   * What this (former main) computer wrote after the backup last confirmed: the newest version of
   * every serial, scan and import row changed since then.
   */
  pendingHandover(): HandoverRecords {
    const acked = num(this.getLocalSync('repl_acked_seq'));
    const latest = new Map<string, ReplEntry>();
    for (const e of this.replEntriesAfter(acked, Number.MAX_SAFE_INTEGER)) {
      latest.set(`${e.tbl}|${e.rid}`, e);
    }
    const rows = (t: ReplicatedTable) =>
      [...latest.values()].filter((e) => e.tbl === t && e.op === 'u' && e.data).map((e) => e.data!);
    const items = rows('import_items');
    return {
      serials: rows('serials'),
      scanLog: rows('scan_log'),
      imports: rows('import_history').map((history) => ({
        history,
        items: items.filter((i) => i.import_id === history.id),
      })),
    };
  }

  async mergeHandover(records: HandoverRecords, now: string): Promise<HandoverResult> {
    const result: HandoverResult = {
      serialsAdded: 0,
      serialsSame: 0,
      conflicts: 0,
      scansAdded: 0,
      importsAdded: 0,
    };
    const s = (v: unknown) =>
      typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
    const sn = (v: unknown) => (typeof v === 'string' ? v : null);
    this.db
      .transaction(() => {
        // Imports first: serials they added point to the import's new number here.
        const importIds = new Map<number, number>();
        for (const { history: h, items } of records.imports) {
          const same = this.one(
            'SELECT id FROM import_history WHERE filename = ? AND imported_at = ? AND imported_by = ?',
            s(h.filename),
            s(h.imported_at),
            s(h.imported_by),
          );
          if (same) {
            importIds.set(num(h.id), num(same.id));
            continue;
          }
          const res = this.run(
            `INSERT INTO import_history (filename, imported_by, imported_by_name, imported_at,
             total_rows, new_count, skipped, conflicts, duplicates, invalid, status, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            s(h.filename),
            s(h.imported_by),
            s(h.imported_by_name),
            s(h.imported_at),
            num(h.total_rows),
            num(h.new_count),
            num(h.skipped),
            num(h.conflicts),
            num(h.duplicates),
            num(h.invalid),
            h.status === 'failed' ? 'failed' : 'completed',
            s(h.error),
          );
          const id = Number(res.lastInsertRowid);
          importIds.set(num(h.id), id);
          result.importsAdded++;
          for (const it of items) {
            const outcome = ITEM_OUTCOMES.find((o) => o === it.outcome) ?? 'invalid';
            this.run(
              `INSERT INTO import_items (import_id, row_number, sheet, serial, company_name, part_no,
               outcome, reason, reason_msg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id,
              num(it.row_number),
              s(it.sheet),
              s(it.serial),
              s(it.company_name),
              s(it.part_no),
              outcome,
              s(it.reason),
              sn(it.reason_msg),
            );
          }
        }
        for (const r of records.serials) {
          const companyId = s(r.company_id);
          const serial = s(r.serial);
          if (!companyId || !serial) continue;
          const here = this.one(
            'SELECT * FROM serials WHERE company_id = ? AND serial = ?',
            companyId,
            serial,
          );
          if (!here) {
            const source = ['excel', 'manual', 'scan'].includes(s(r.source))
              ? s(r.source)
              : 'manual';
            const oldImport =
              r.import_id === null || r.import_id === undefined ? null : num(r.import_id);
            this.run(
              `INSERT INTO serials (company_id, serial, part_no, company_name, source, scanned_at,
               scanned_by, scanned_by_name, node_id, node_name, import_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              companyId,
              serial,
              s(r.part_no),
              s(r.company_name),
              source,
              s(r.scanned_at),
              s(r.scanned_by),
              s(r.scanned_by_name),
              s(r.node_id),
              s(r.node_name),
              oldImport === null ? null : (importIds.get(oldImport) ?? null),
            );
            result.serialsAdded++;
          } else if (s(here.part_no) === s(r.part_no)) {
            result.serialsSame++;
          } else {
            // Registered on both computers with different details: the admin decides.
            this.run(
              `INSERT INTO handover_conflicts (serial, company_id, company_name, part_no, node_name,
               scanned_at, other_part_no, other_node_name, other_scanned_at, reported_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(company_id, serial) DO UPDATE SET other_part_no = excluded.other_part_no,
               other_node_name = excluded.other_node_name,
               other_scanned_at = excluded.other_scanned_at, reported_at = excluded.reported_at`,
              serial,
              companyId,
              s(here.company_name),
              s(here.part_no),
              s(here.node_name),
              sn(here.scanned_at),
              s(r.part_no),
              s(r.node_name),
              sn(r.scanned_at),
              now,
            );
            result.conflicts++;
          }
        }
        for (const r of records.scanLog) {
          const kind = ['scan', 'import', 'reprint'].includes(s(r.kind)) ? s(r.kind) : 'scan';
          const res = r.result === 'duplicate' ? 'duplicate' : 'new';
          const same = this.one(
            `SELECT id FROM scan_log WHERE serial = ? AND company_id = ? AND timestamp = ?
             AND node_id = ? AND kind = ? AND result = ?`,
            s(r.serial),
            s(r.company_id),
            s(r.timestamp),
            s(r.node_id),
            kind,
            res,
          );
          if (same) continue;
          this.run(
            `INSERT INTO scan_log (serial, result, company_id, company_name, source, scanned_by,
             scanned_by_name, node_id, node_name, timestamp, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            s(r.serial),
            res,
            s(r.company_id),
            s(r.company_name),
            s(r.source),
            s(r.scanned_by),
            s(r.scanned_by_name),
            s(r.node_id),
            s(r.node_name),
            s(r.timestamp),
            kind,
          );
          result.scansAdded++;
        }
      })
      .immediate();
    return result;
  }

  async listConflicts(): Promise<HandoverConflict[]> {
    return this.all('SELECT * FROM handover_conflicts ORDER BY id DESC LIMIT 500').map((r) => ({
      serial: str(r.serial),
      company: str(r.company_name),
      companyId: str(r.company_id),
      partNo: str(r.part_no),
      nodeName: str(r.node_name),
      scannedAt: strOrNull(r.scanned_at),
      otherPartNo: str(r.other_part_no),
      otherNodeName: str(r.other_node_name),
      otherScannedAt: strOrNull(r.other_scanned_at),
      reportedAt: str(r.reported_at),
    }));
  }
  async clearConflicts() {
    this.run('DELETE FROM handover_conflicts');
  }
}
