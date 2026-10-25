/**
 * The desktop app's bridge between the page (renderer) and Electron's main process, exposed by the
 * preload script as `window.desktop`. Absent in the web app. The page never talks to the network
 * itself in the desktop app: every server call, credential and session lives in the main process.
 */
import type { ConnectionState } from '../data/DataService';
import type { OpIn, OpName, OpOut, ServerEvent, WireResult } from './protocol';

export type DesktopMode = 'server' | 'node';

export interface DesktopInfo {
  /** null until first-run setup is done. */
  mode: DesktopMode | null;
  appVersion: string;
  stationName: string;
  connection: ConnectionState;
  serverId: string | null;
  /** Shown only in Advanced sections. */
  serverAddress: string | null;
  /** Server mode: this computer's addresses and the database file location. */
  lanAddresses: string[];
  dbFile: string | null;
  /**
   * main     the main computer
   * retired  was the main computer; a backup was promoted (hand over, then become a station)
   * backup   a station that is the backup main computer
   * station  any other station
   */
  role: 'main' | 'retired' | 'backup' | 'station' | null;
  term: number;
  /** On the backup: its copy of the data. */
  backupCopy: {
    receiving: boolean;
    lastCopiedAt: string | null;
    /** Has every change of the main computer right now. */
    complete: boolean;
    /** Ever had a complete copy (false: most data may be missing). */
    everComplete: boolean;
    /** While the first full copy arrives: 0–99, else null. */
    copyProgress: number | null;
  } | null;
}

export interface PromoteInput {
  email: string;
  /** The administrator's password, or the recovery code with a new password. */
  password?: string;
  recoveryCode?: string;
  newPassword?: string;
  /** Ticked "I understand recent serials may be missing" (needed unless a planned switch). */
  understood: boolean;
}

export interface DiscoveredServer {
  serverId: string;
  /** Short display form of the server ID (no address is ever shown during setup). */
  label: string;
  /** The main computer's name (its computer name), '' if unknown. */
  name: string;
  host: string;
  port: number;
}

export interface SignedIn {
  uid: string;
  email: string;
}

export type DesktopEvent =
  | { type: 'connection'; state: ConnectionState }
  | { type: 'auth'; user: SignedIn | null }
  | { type: 'server'; event: ServerEvent }
  | { type: 'discovery'; servers: DiscoveredServer[] }
  /** This computer's role or backup copy changed: re-read info(). */
  | { type: 'cluster' };

export interface DesktopBridge {
  info(): Promise<DesktopInfo>;
  on(listener: (event: DesktopEvent) => void): () => void;

  // ---- first-run setup ----
  /** Returns the admin password recovery code (shown once). */
  setupServer(admin: {
    name: string;
    email: string;
    password: string;
  }): Promise<WireResult<{ recoveryCode: string }>>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  /** Pairs with the 6-digit code; the station is named on the station setup screen next. */
  pairStation(input: { server: DiscoveredServer; code: string }): Promise<WireResult<null>>;
  /** After this computer was removed by an administrator: forget the pairing, back to setup. */
  resetPairing(): Promise<void>;

  // ---- backup main computer ----
  /** On the backup: become the main computer. A new recovery code if one was used. */
  promote(input: PromoteInput): Promise<WireResult<{ recoveryCode: string | null }>>;
  /**
   * On a former main computer: send the new main computer what it may be missing, then become a
   * station (re-using this computer's pairing). Confirmed with an administrator's password.
   */
  handover(input: {
    email: string;
    password: string;
  }): Promise<WireResult<import('./protocol').HandoverResult>>;

  // ---- data (main adds the station credential and the person's session) ----
  call<K extends OpName>(op: K, input: OpIn<K>): Promise<WireResult<OpOut<K>>>;
  signedIn(): Promise<SignedIn | null>;

  // ---- printing on this station ----
  listPrinters(): Promise<string[]>;
  getPrinter(): Promise<string | null>;
  setPrinter(name: string): Promise<void>;
  /** Prints the page's current print layout silently on the chosen printer, at this paper size. */
  printLabel(sizeMm: { width: number; height: number }): Promise<WireResult<null>>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/** The bridge, or null in the web app. */
export function desktopBridge(): DesktopBridge | null {
  return typeof window !== 'undefined' && window.desktop ? window.desktop : null;
}
