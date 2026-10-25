/**
 * The app's single entry point to shared data. UI code imports `dataService` from here and
 * nothing from services/firebase or the Firestore-backed services (see DataService.ts).
 *
 * The web app uses Firebase; the desktop build swaps in its server-backed implementation
 * (./selectedBackend.ts, replaced at build time by vite.config.ts in desktop mode).
 */
import type { DataService } from './DataService';
import { selectedBackend } from './selectedBackend';

export const dataService: DataService = selectedBackend;

export type {
  AuthIdentity,
  BackendCapabilities,
  ConnectionState,
  NewUserInput,
  Recorder,
  BackendConfiguration,
  DashboardCounts,
  DataService,
  HistoryCursor,
  ImportConfirmResult,
  RegisterSerialInput,
  ScanHistoryFilters,
  ScanHistoryPage,
  Unsubscribe,
} from './DataService';
