/**
 * DataService backed by Firebase (Auth + Firestore). A thin adapter: every method delegates to the
 * existing services, which keep all Firestore logic, validation and security assumptions. The
 * only thing added here is deriving the acting admin for admin writes (previously done by the UI).
 */
import { missingFirebaseVars, isFirebaseConfigured } from '../../config/firebase';
import {
  countActiveCompanies,
  countActiveOperators,
  countCompanies,
  countDuplicateAttemptsBetween,
  countSerials,
  countSerialsForCompany,
  countSerialsRegisteredBetween,
} from '../../services/admin/dashboardService';
import { getExportHistory, recordExportHistory } from '../../services/admin/exportHistoryService';
import { getScanHistoryPage } from '../../services/admin/scanHistoryService';
import {
  createCompany,
  getAllCompanies,
  updateCompany,
} from '../../services/companies/companyAdminService';
import { getActiveCompanies } from '../../services/companies/companyService';
import {
  confirmImportPreview,
  exportSerialsToExcel,
  getImportHistory,
  previewImportFile,
} from '../../services/excel';
import { signInWithEmail, signOutUser, subscribeToAuth } from '../../services/firebase/auth';
import { getFirebase } from '../../services/firebase/client';
import { getRecentScans } from '../../services/scans/scanLogService';
import { verifyAndRegisterSerial } from '../../services/serial';
import { currentAdmin } from '../../services/users/currentAdmin';
import { applyUserChange, getAllUsers } from '../../services/users/userAdminService';
import { saveUserPreferences, subscribeToUserProfile } from '../../services/users/userService';
import { msg } from '../../i18n/core';
import { AppError } from '../../services/errors';
import type { DataService, HistoryCursor } from '../DataService';

const unsupported = async (): Promise<never> => {
  throw new AppError('unsupported', msg('errors.unsupported'));
};

type FirestoreCursor = Parameters<typeof getScanHistoryPage>[1];

export const firebaseDataService: DataService = {
  configuration: { ready: isFirebaseConfigured, missing: missingFirebaseVars },
  capabilities: {
    companyLabelSize: false,
    manageAccounts: false,
    stations: false,
    stationScanning: false,
    serialLookup: false,
  },
  // Firebase manages its own connectivity; the web app has no separate server link to report.
  onConnectionChange: (onChange) => {
    onChange('online');
    return () => undefined;
  },
  // No live push in the web app (recent scans refresh after the operator's own scans).
  onScansChanged: () => () => undefined,

  onAuthChange: (onChange, onError) => subscribeToAuth(onChange, onError),
  login: signInWithEmail,
  logout: signOutUser,
  currentUserId: () => getFirebase().auth.currentUser?.uid ?? null,
  watchOwnProfile: subscribeToUserProfile,
  saveUserPreferences,

  registerSerial: (input) => verifyAndRegisterSerial(input),
  getRecentScans: (count) => getRecentScans(count),
  getScanHistoryPage: async (filters, after = null) => {
    // The Firestore document snapshot travels through the UI only as an opaque cursor.
    const page = await getScanHistoryPage(filters, after as unknown as FirestoreCursor);
    return { ...page, cursor: page.cursor as unknown as HistoryCursor | null };
  },

  getActiveCompanies: () => getActiveCompanies(),
  getAllCompanies: () => getAllCompanies(),
  createCompany: async (input) => createCompany(input, await currentAdmin()),
  updateCompany: async (companyId, input) => updateCompany(companyId, input, await currentAdmin()),

  getUsers: () => getAllUsers(),
  getRecorders: async () => (await getAllUsers()).map((u) => ({ id: u.uid, name: u.name })),
  // Firebase accounts are created and reset in the Firebase console, never in the app.
  createUser: unsupported,
  setUserPassword: unsupported,
  changeUser: async (input) => applyUserChange(input, await currentAdmin()),

  counts: {
    serials: () => countSerials(),
    serialsForCompany: (companyId) => countSerialsForCompany(companyId),
    serialsRegisteredBetween: (start, end) => countSerialsRegisteredBetween(start, end),
    duplicateAttemptsBetween: (start, end) => countDuplicateAttemptsBetween(start, end),
    companies: () => countCompanies(),
    activeCompanies: () => countActiveCompanies(),
    activeOperators: () => countActiveOperators(),
  },

  previewImport: previewImportFile,
  confirmImport: confirmImportPreview,
  getImportHistory: (count) => getImportHistory(count),
  getImportDetails: unsupported,
  findSerials: unsupported,
  reprintLabel: unsupported,

  exportSerials: exportSerialsToExcel,
  recordExport: async (entry) => recordExportHistory(entry, await currentAdmin()),
  getExportHistory: (count) => getExportHistory(count),
};
