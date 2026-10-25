/**
 * DataService for the desktop app (Electron). Every call goes through the preload bridge to the
 * main process, which holds the station credential and the person's session and talks to the
 * main computer (server) over pinned TLS. The page itself never touches the network.
 *
 * Registration while the server is unreachable is refused immediately (no local queue).
 */
import { enText, msg, type Msg } from '../../i18n/core';
import { AppError } from '../../services/errors';
import { buildExportDataset } from '../../services/excel/exportDataset';
import { exportFilename } from '../../services/excel/exportFilename';
import { buildWorkbook, XLSX_MIME } from '../../services/excel/exportWorkbook';
import { parseImportFile } from '../../services/excel/importParser';
import { logError } from '../../utils/log';
import { desktopBridge, type DesktopBridge, type SignedIn } from '../../desktop/bridge';
import type { OpIn, OpName, OpOut, WireResult } from '../../desktop/protocol';
import type { VerificationResult } from '../../services/serial/serialVerification';
import type { ConnectionState, DataService, HistoryCursor } from '../DataService';

function bridge(): DesktopBridge {
  const b = desktopBridge();
  if (!b) throw new AppError('config', msg('errors.config'));
  return b;
}

function unwrap<T>(r: WireResult<T>): T {
  if (r.ok) return r.data;
  throw new AppError(r.error.code, r.error.msg ?? r.error.message);
}

const call = async <K extends OpName>(op: K, input: OpIn<K>): Promise<OpOut<K>> =>
  unwrap(await bridge().call(op, input));

// Live state mirrored from the main process (kept current by one subscription).
let connection: ConnectionState = 'connecting';
let signedIn: SignedIn | null = null;
const connectionListeners = new Set<(s: ConnectionState) => void>();
const authListeners = new Set<(u: SignedIn | null) => void>();
const scanListeners = new Set<() => void>();
const profileListeners = new Map<string, Set<() => void>>();

let started = false;
function start() {
  if (started) return;
  started = true;
  const b = bridge();
  b.on((event) => {
    if (event.type === 'connection') {
      connection = event.state;
      for (const l of connectionListeners) l(connection);
    } else if (event.type === 'auth') {
      signedIn = event.user;
      for (const l of authListeners) l(signedIn);
    } else if (event.type === 'server') {
      const e = event.event;
      if (e.type === 'scan') for (const l of scanListeners) l();
      if (e.type === 'user-changed') for (const l of profileListeners.get(e.uid) ?? []) l();
    }
  });
  void b.info().then((info) => {
    connection = info.connection;
    for (const l of connectionListeners) l(connection);
  });
}

function refusedRegistration(state: ConnectionState): VerificationResult {
  const m: Msg =
    state === 'update-required'
      ? msg('status.updateRequired')
      : state === 'revoked'
        ? msg('server.revoked')
        : msg('server.unreachable');
  return {
    result: 'error',
    code: state === 'update-required' ? 'update-required' : 'server-unreachable',
    message: enText(m),
    msg: m,
  };
}

export const desktopDataService: DataService = {
  configuration: { ready: true, missing: [] },
  capabilities: {
    companyLabelSize: true,
    manageAccounts: true,
    stations: true,
    stationScanning: true,
    serialLookup: true,
  },

  onConnectionChange(onChange) {
    start();
    connectionListeners.add(onChange);
    onChange(connection);
    return () => connectionListeners.delete(onChange);
  },
  onScansChanged(onChange) {
    start();
    scanListeners.add(onChange);
    return () => scanListeners.delete(onChange);
  },

  onAuthChange(onChange) {
    start();
    const listener = (u: SignedIn | null) => onChange(u ? { uid: u.uid, email: u.email } : null);
    authListeners.add(listener);
    void bridge()
      .signedIn()
      .then((u) => {
        signedIn = u;
        listener(u);
      });
    return () => authListeners.delete(listener);
  },
  login: async (email, password) => {
    await call('auth.login', { email, password });
  },
  logout: async () => {
    await call('auth.logout', {});
  },
  currentUserId: () => signedIn?.uid ?? null,
  watchOwnProfile(uid, onProfile, onError) {
    start();
    let active = true;
    const load = () =>
      call('me', {})
        .then((u) => active && onProfile(u))
        .catch((e: unknown) => {
          // An ended session is reported through onAuthChange (signed out), not as an error.
          if (!active || (e instanceof AppError && e.code === 'session-expired')) return;
          onError(
            e instanceof AppError ? e : new AppError('unknown', msg('auth.profileLoadFailed')),
          );
        });
    const set = profileListeners.get(uid) ?? new Set();
    set.add(load);
    profileListeners.set(uid, set);
    void load();
    return () => {
      active = false;
      set.delete(load);
    };
  },
  saveUserPreferences: async (_uid, prefs) => {
    await call('prefs.save', prefs);
  },

  async registerSerial(input) {
    start();
    if (connection !== 'online') return refusedRegistration(connection);
    try {
      return await call('serials.register', {
        serial: input.serial,
        companyId: input.companyId,
        source: input.source,
        ...(input.partNo ? { partNo: input.partNo } : {}),
      });
    } catch (e) {
      if (
        e instanceof AppError &&
        (e.code === 'server-unreachable' || e.code === 'update-required' || e.code === 'revoked')
      ) {
        return refusedRegistration(e.code === 'server-unreachable' ? 'offline' : e.code);
      }
      throw e;
    }
  },
  getRecentScans: (count) => call('scans.recent', { count }),
  async getScanHistoryPage(filters, after = null) {
    const page = await call('scans.history', {
      filters: {
        ...(filters.result ? { result: filters.result } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.companyId ? { companyId: filters.companyId } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.scannedBy ? { scannedBy: filters.scannedBy } : {}),
        ...(filters.from ? { from: filters.from.toISOString() } : {}),
        ...(filters.to ? { to: filters.to.toISOString() } : {}),
      },
      after: after as unknown as number | null,
    });
    return {
      entries: page.entries,
      partNumbers: new Map(Object.entries(page.partNumbers)),
      cursor: page.cursor as unknown as HistoryCursor | null,
      hasMore: page.hasMore,
    };
  },

  getActiveCompanies: () => call('companies.active', {}),
  getAllCompanies: () => call('companies.all', {}),
  createCompany: (input) => call('companies.create', { input }),
  updateCompany: async (id, input) => {
    await call('companies.update', { id, input });
  },

  getUsers: () => call('users.list', {}),
  // Records are registered by stations: the history filter lists them (with their usual operator).
  getRecorders: async () =>
    (await call('nodes.list', {})).map((n) => ({
      id: n.id,
      name: n.operatorName ? `${n.name} (${n.operatorName})` : n.name,
    })),
  createUser: async (input) => {
    await call('users.create', input);
  },
  setUserPassword: async (uid, password) => {
    await call('users.setPassword', { uid, password });
  },
  changeUser: async ({ target, change }) => {
    await call('users.change', { uid: target.uid, change });
  },

  counts: {
    serials: () => call('counts', { metric: 'serials' }),
    serialsForCompany: (companyId) => call('counts', { metric: 'serialsForCompany', companyId }),
    serialsRegisteredBetween: (start, end) =>
      call('counts', {
        metric: 'serialsRegisteredBetween',
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    duplicateAttemptsBetween: (start, end) =>
      call('counts', {
        metric: 'duplicateAttemptsBetween',
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    companies: () => call('counts', { metric: 'companies' }),
    activeCompanies: () => call('counts', { metric: 'activeCompanies' }),
    activeOperators: () => call('counts', { metric: 'activeOperators' }),
  },

  // The workbook is read on this computer (no upload of the file); the server checks the rows.
  async previewImport(file, onProgress) {
    const parsed = await parseImportFile(await file.arrayBuffer(), file.name);
    onProgress?.(0, parsed.rows.length);
    const preview = await call('import.preview', {
      filename: file.name,
      sheetName: parsed.sheetName,
      sheets: parsed.sheets,
      rows: parsed.rows,
    });
    onProgress?.(parsed.rows.length, parsed.rows.length);
    return preview;
  },
  async confirmImport(preview, onProgress) {
    onProgress?.(0, preview.counts.new);
    const result = await call('import.confirm', { preview });
    onProgress?.(preview.counts.new, preview.counts.new);
    return result;
  },
  getImportHistory: (count) => call('import.history', { count }),
  getImportDetails: (importId) => call('import.details', { importId }),
  findSerials: (query) => call('serials.search', { query }),
  reprintLabel: (companyId, serial) => call('labels.reprint', { companyId, serial }),

  async exportSerials(opts) {
    opts.onPhase?.('preparing');
    const data = await call('export.data', {});
    opts.onProgress?.(data.serials.length);
    opts.onPhase?.('generating');
    const now = new Date();
    try {
      const dataset = buildExportDataset({
        serials: data.serials.map((s) => ({
          serial: s.serial,
          partNo: s.partNo,
          company: s.company,
          companyId: s.companyId,
          source: s.source,
          scannedAt: s.scannedAt ? new Date(s.scannedAt) : null,
          scannedByName: s.scannedByName,
          incomplete: false,
        })),
        companies: data.companies,
        exportedAt: now,
        exportedBy: opts.exportedBy,
      });
      const bytes = await buildWorkbook(dataset);
      return {
        blob: new Blob([bytes], { type: XLSX_MIME }),
        filename: exportFilename(now),
        recordCount: dataset.summary.total,
      };
    } catch (e) {
      logError('Excel generation failed', e);
      throw new AppError('unknown', msg('export.generateFailed'));
    }
  },
  recordExport: async (entry) => {
    await call('export.record', entry);
  },
  getExportHistory: (count) => call('export.history', { count }),
};
