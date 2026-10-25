/**
 * THE data boundary of the app. Every read and write of shared data (sign-in, serial registration,
 * history, companies, users, Excel import/export, preferences) goes through this interface, and
 * the UI (src/app, features, pages, layouts, hooks) reaches the backend ONLY through it
 * (enforced by tests/architecture.test.ts).
 *
 * Today the implementation is Firebase (./firebase). The desktop build will supply a second
 * implementation that talks to the local server; nothing above this interface has to change.
 *
 * Contract for every implementation:
 *  - Failures are thrown as AppError (services/errors), carrying a translatable message.
 *  - The ACTING USER is never passed in: the backend derives it from the signed-in session (the
 *    server will do the same), so a caller can never act or register as someone else.
 *  - Timestamps are ISO strings set by the backend, never by the caller's clock.
 */
import type { AppError } from '../services/errors';
import type { ScanHistoryFilters } from '../services/admin/scanHistoryService';
import type { ExportPhase, ExportResult } from '../services/excel/exportService';
import type { ImportOutcome, ImportPreview } from '../services/excel/importTypes';
import type { CompanyInput } from '../services/companies/companyValidation';
import type { UserChange } from '../services/users/userChangeRules';
import type { VerificationResult, VerifyInput } from '../services/serial/serialVerification';
import type {
  Company,
  ExportHistoryEntry,
  FoundSerial,
  ImportDetails,
  ImportHistoryEntry,
  Language,
  ScanLog,
  Theme,
  User,
  UserRole,
} from '../types';

export type { ScanHistoryFilters };

/** Stops a live subscription. */
export type Unsubscribe = () => void;

/** Who is signed in (identity only; role and status come from the profile). */
export interface AuthIdentity {
  uid: string;
  email: string | null;
}

/** Serial registration request. Who registers is derived by the backend, never supplied. */
export type RegisterSerialInput = Omit<VerifyInput, 'partNo'> & { partNo?: string };

/** Opaque "continue after this" token for history paging; only the backend understands it. */
export interface HistoryCursor {
  readonly __historyCursor: unique symbol;
}

export interface ScanHistoryPage {
  entries: ScanLog[];
  /** Part number per serial, for the rows on this page ('' when unknown). */
  partNumbers: Map<string, string>;
  /** Pass back to get the next page; null when there is no next page to ask for. */
  cursor: HistoryCursor | null;
  hasMore: boolean;
}

export interface ImportConfirmResult {
  outcome: ImportOutcome;
  /** False if the import ran but its history entry could not be saved. */
  historyRecorded: boolean;
}

/** Dashboard counts; each is independent so one failure never hides the others. */
export interface DashboardCounts {
  serials(): Promise<number>;
  serialsForCompany(companyId: string): Promise<number>;
  serialsRegisteredBetween(start: Date, end: Date): Promise<number>;
  duplicateAttemptsBetween(start: Date, end: Date): Promise<number>;
  companies(): Promise<number>;
  activeCompanies(): Promise<number>;
  activeOperators(): Promise<number>;
}

/**
 * The link to the backend, for the status banner. The web app is always 'online' (Firebase handles
 * its own connectivity); the desktop node reports the state of its link to the main computer.
 *  connecting       looking for / connecting to the main computer
 *  offline          the main computer cannot be reached: nothing can be checked or registered
 *  update-required  this computer's app version differs from the main computer's
 *  revoked          an administrator removed this computer; it must be paired again
 */
export type ConnectionState = 'online' | 'connecting' | 'offline' | 'update-required' | 'revoked';

/** Optional features; the UI shows the matching controls only when the backend has them. */
export interface BackendCapabilities {
  /** Each company has its own label size (desktop server). */
  companyLabelSize: boolean;
  /** Admins create accounts and set passwords in the app (desktop). Firebase uses its console. */
  manageAccounts: boolean;
  /** Records carry the station (computer) they were registered on (desktop). */
  stations: boolean;
  /**
   * Paired stations scan without anyone signing in; only admin pages need a sign-in (desktop).
   * The web app: everyone signs in.
   */
  stationScanning: boolean;
  /**
   * Admins can look up any serial, reprint its label (logged as a reprint) and see what each
   * Excel import added or skipped (desktop server).
   */
  serialLookup: boolean;
}

/** Who registered records, for the history filter: stations (desktop) or people (web). */
export interface Recorder {
  id: string;
  name: string;
}

export interface NewUserInput {
  name: string;
  email: string;
  role: UserRole;
  password: string;
}

/** Why the backend cannot start, for the "not configured" screen ([] = ready). */
export interface BackendConfiguration {
  ready: boolean;
  /** Names of missing settings (shown to the person setting the system up). */
  missing: string[];
}

export interface DataService {
  // ---- configuration and link state ----
  configuration: BackendConfiguration;
  capabilities: BackendCapabilities;
  /** Calls `onChange` now and on every change of the link to the backend. */
  onConnectionChange(onChange: (state: ConnectionState) => void): Unsubscribe;
  /** Calls `onChange` whenever a scan is registered anywhere (live history); may never fire. */
  onScansChanged(onChange: () => void): Unsubscribe;

  // ---- sign-in and the signed-in user's own profile ----
  /** Calls `onChange` now and whenever the signed-in identity changes (null = signed out). */
  onAuthChange(
    onChange: (identity: AuthIdentity | null) => void,
    onError: (error: AppError) => void,
  ): Unsubscribe;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** The signed-in user's id right now, or null. */
  currentUserId(): string | null;
  /** Live view of the signed-in user's own profile (role/active changes apply immediately). */
  watchOwnProfile(
    uid: string,
    onProfile: (user: User | null) => void,
    onError: (error: AppError) => void,
  ): Unsubscribe;
  /** Saves the signed-in user's own display preferences (nothing else on the profile). */
  saveUserPreferences(
    uid: string,
    preferences: { language: Language; theme: Theme },
  ): Promise<void>;

  // ---- serials (the ONE registration path for manual entry and OCR) ----
  /**
   * Validates and registers atomically: 'new' or 'duplicate' only once the backend has committed;
   * 'invalid' / 'error' never register anything.
   */
  registerSerial(input: RegisterSerialInput): Promise<VerificationResult>;
  getRecentScans(count: number): Promise<ScanLog[]>;
  getScanHistoryPage(
    filters: ScanHistoryFilters,
    after?: HistoryCursor | null,
  ): Promise<ScanHistoryPage>;

  // ---- companies ----
  /** Active companies (what operators may select). */
  getActiveCompanies(): Promise<Company[]>;
  /** Admin: every company, including inactive ones. */
  getAllCompanies(): Promise<Company[]>;
  /** Admin: creates a company; returns its id. Never overwrites an existing one. */
  createCompany(input: CompanyInput): Promise<string>;
  /** Admin: edits a company. Registered serials and history are never changed. */
  updateCompany(companyId: string, input: CompanyInput): Promise<void>;

  // ---- users (admin) ----
  getUsers(): Promise<User[]>;
  /** Admin: the history filter's choices (scan_log.scannedBy values with display names). */
  getRecorders(): Promise<Recorder[]>;
  /** Admin: creates an account (only when capabilities.manageAccounts). */
  createUser(input: NewUserInput): Promise<void>;
  /** Admin: sets a new password for an account (only when capabilities.manageAccounts). */
  setUserPassword(uid: string, password: string): Promise<void>;
  /** Changes ANOTHER user's role and/or active flag (self-changes and removing the last admin are refused). */
  changeUser(input: { target: User; change: UserChange; users: User[] }): Promise<void>;

  // ---- dashboard (admin) ----
  counts: DashboardCounts;

  // ---- Excel import (admin): preview never writes; confirm never overwrites ----
  previewImport(
    file: File,
    onProgress?: (checked: number, total: number) => void,
  ): Promise<ImportPreview>;
  confirmImport(
    preview: ImportPreview,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ImportConfirmResult>;
  getImportHistory(count: number): Promise<ImportHistoryEntry[]>;
  /** Admin: what each row of one import did (only when capabilities.serialLookup). */
  getImportDetails(importId: string): Promise<ImportDetails>;

  // ---- find and reprint (admin; only when capabilities.serialLookup) ----
  /** Any serial, registered at a station or imported: exact, or starting with `query`. */
  findSerials(query: string): Promise<FoundSerial[]>;
  /**
   * Records an admin reprint of an existing serial's label (in Scan History, as a reprint) and
   * returns what to print. Refused unless an administrator is signed in.
   */
  reprintLabel(companyId: string, serial: string): Promise<FoundSerial>;

  // ---- Excel export (admin) ----
  exportSerials(opts: {
    /** Display name written into the workbook. */
    exportedBy: string;
    onPhase?: (phase: ExportPhase) => void;
    onProgress?: (serialsRead: number) => void;
  }): Promise<ExportResult>;
  /** Audit entry for a completed export. */
  recordExport(entry: { filename: string; recordCount: number }): Promise<void>;
  getExportHistory(count: number): Promise<ExportHistoryEntry[]>;
}
