/**
 * The server's operations (one handler per protocol op). Authentication and role checks happen in
 * server.ts BEFORE a handler runs (see OP_ACCESS); handlers receive the verified station and person.
 *
 * Every business rule reuses the web app's pure modules, so the desktop refuses and accepts exactly
 * what the web app does: serial normalisation and company checks (checkSerialForCompany), company
 * validation, user-change protection, Excel import classification.
 */
import { enText, msg, type Msg } from '../../../web/src/i18n/core';
import { AppError } from '../../../web/src/services/errors';
import { normalizeSerial } from '../../../web/src/utils/serial';
import { checkSerialForCompany } from '../../../web/src/services/serial/serialChecks';
import type { VerificationResult } from '../../../web/src/services/serial/serialVerification';
import {
  MAX_PART_LENGTH,
  serialValueProblem,
} from '../../../web/src/services/serial/serialValidation';
import {
  companyIdFromName,
  labelMm,
  validateCompanyInput,
  type CompanyInput,
} from '../../../web/src/services/companies/companyValidation';
import { checkUserChange } from '../../../web/src/services/users/userChangeRules';
import {
  classifyAgainstFirestore,
  companySerialKey,
  compareWithExisting,
  countRows,
  normalizeRows,
} from '../../../web/src/services/excel/importClassify';
import type {
  ClassifiedRow,
  ExistingSerialInfo,
  ImportOutcome,
} from '../../../web/src/services/excel/importTypes';
import type {
  OpIn,
  OpName,
  OpOut,
  ServerEvent,
  StationProfile,
} from '../../../web/src/desktop/protocol';
import type { CodeType, ImportItem, ImportItemOutcome, User } from '../../../web/src/types';
import type { PairingManager } from './pairing';
import {
  hashPassword,
  hashToken,
  MIN_PASSWORD_LENGTH,
  newId,
  newRecoveryCode,
  newToken,
  normalizeRecoveryCode,
  verifyPassword,
} from './secrets';
import type { Cluster } from './cluster';
import type { Actor, NodeRecord, Station, Store, StoredUser } from './store';

export const HISTORY_PAGE_SIZE = 25;
/** Most results the admin serial search returns. */
export const SEARCH_LIMIT = 50;
/** Administrator sign-ins end after this many minutes without activity (configurable). */
export const DEFAULT_ADMIN_IDLE_MINUTES = 15;
export const MAX_ADMIN_IDLE_MINUTES = 240;
const MAX_NAME = 60;

export async function adminIdleMinutes(store: Store): Promise<number> {
  const v = Number(await store.getMeta('admin_idle_minutes'));
  return Number.isInteger(v) && v >= 1 && v <= MAX_ADMIN_IDLE_MINUTES
    ? v
    : DEFAULT_ADMIN_IDLE_MINUTES;
}

/** A station's own profile, as it knows itself. */
const profileOf = (node: NodeRecord): StationProfile => ({
  nodeId: node.id,
  name: node.name,
  operatorName: node.operatorName,
  configured: node.configured,
  isServer: node.isServer,
});

/** Station name (required) and usual operator (optional), trimmed and limited. */
function stationNames(input: { name: string; operatorName: string }) {
  const name = String(input.name ?? '')
    .trim()
    .slice(0, MAX_NAME);
  const operatorName = String(input.operatorName ?? '')
    .trim()
    .slice(0, MAX_NAME);
  if (!name) fail('invalid-data', msg('pairing.nameRequired'));
  return { name, operatorName };
}

/** Who is calling: the verified station, and (for signed-in ops) the verified person. */
export interface CallContext {
  node: NodeRecord;
  user: StoredUser | null;
  sessionHash: string | null;
  /** Request came from this machine (the server's own window). */
  local: boolean;
}

export interface ApiDeps {
  store: Store;
  pairing: PairingManager;
  now: () => Date;
  broadcast: (event: ServerEvent) => void;
  cluster: Cluster;
  /** Disconnects a revoked station's live connection immediately. */
  disconnectNode: (nodeId: string) => void;
  /** Ends live state for sessions that were removed (sign-out everywhere). */
  sessionsEnded: (userId: string) => void;
  serverId: string;
  version: string;
}

type Handler<K extends OpName> = (input: OpIn<K>, ctx: CallContext) => Promise<OpOut<K>>;
export type Handlers = { [K in OpName]: Handler<K> };

const fail = (code: ConstructorParameters<typeof AppError>[0], m: Msg): never => {
  throw new AppError(code, m);
};
const text = (m: Msg) => ({ message: enText(m), msg: m });

function actorOf(ctx: CallContext): Actor {
  if (!ctx.user) return fail('session-expired', msg('auth.sessionExpired'));
  return { uid: ctx.user.uid, name: ctx.user.name };
}
const stationOf = (ctx: CallContext): Station => ({ id: ctx.node.id, name: ctx.node.name });

/** Simple sign-in throttle per email: 5 failures -> 30 s pause. */
class LoginThrottle {
  private readonly failures = new Map<string, { count: number; until: number }>();
  blocked(email: string, now: number) {
    const f = this.failures.get(email);
    return !!f && f.until > now;
  }
  failed(email: string, now: number) {
    const f = this.failures.get(email) ?? { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= 5) {
      f.count = 0;
      f.until = now + 30_000;
    }
    this.failures.set(email, f);
  }
  succeeded(email: string) {
    this.failures.delete(email);
  }
}

function companyFromInput(input: CompanyInput) {
  const errors = validateCompanyInput(input);
  const first = Object.values(errors)[0];
  if (first) fail('invalid-data', first);
  const width = labelMm(input.labelWidthMm?.trim() ?? '');
  const height = labelMm(input.labelHeightMm?.trim() ?? '');
  return {
    name: input.name.trim(),
    codeType: input.codeType as CodeType,
    serialFormat: input.serialFormat.trim(),
    active: input.active,
    labelSize: width !== null && height !== null ? { widthMm: width, heightMm: height } : null,
  };
}

function validNewUser(input: { name: string; email: string; role: string; password: string }) {
  if (!input.name.trim()) fail('invalid-data', msg('users.nameRequired'));
  if (!/^[^\s@]+@[^\s@]+$/.test(input.email.trim()))
    fail('invalid-data', msg('login.emailInvalid'));
  if (input.role !== 'operator' && input.role !== 'admin')
    fail('invalid-data', msg('errors.generic'));
  validPassword(input.password);
}
function validPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail('invalid-data', msg('users.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
  }
}

/**
 * Sets a new recovery code (the previous one stops working) and returns it. Shown once; only its
 * hash is kept, so a forgotten admin password can be replaced on the main computer or the backup.
 */
export async function issueRecoveryCode(store: Store): Promise<string> {
  const code = newRecoveryCode();
  await store.setMeta('recovery_hash', await hashPassword(normalizeRecoveryCode(code)));
  return code;
}

/** Checks a recovery code against the stored hash. */
export async function checkRecoveryCode(store: Store, code: string): Promise<boolean> {
  const stored = await store.getMeta('recovery_hash');
  const typed = normalizeRecoveryCode(code);
  return !!stored && typed.length === 20 && verifyPassword(typed, stored);
}

/** Why registering is not possible right now (network-split rule), as a message. */
const pausedMsg = (state: 'waiting' | 'paused') =>
  msg(state === 'waiting' ? 'cluster.waiting' : 'cluster.paused');
const notMain = () => fail('not-main', msg('cluster.notMain'));

export function createHandlers(deps: ApiDeps): Handlers {
  const { store, cluster } = deps;
  const iso = () => deps.now().toISOString();
  const throttle = new LoginThrottle();
  const recoveryThrottle = new LoginThrottle();

  /** The network-split rule, before anything that registers serials. */
  const mayRegister = async () => {
    const state = await cluster.registerState();
    if (state === 'not-main') notMain();
    if (state === 'waiting' || state === 'paused') fail('paused', pausedMsg(state));
  };

  return {
    hello: async (_in, ctx) => ({
      serverId: deps.serverId,
      version: deps.version,
      station: profileOf(ctx.node),
      cluster: cluster.info(),
    }),

    // One-time setup by the station itself; afterwards only an administrator can change it.
    'station.setup': async (input, ctx) => {
      if (ctx.node.configured) fail('invalid-data', msg('stationSetup.alreadyDone'));
      const names = stationNames(input);
      await store.updateNode(ctx.node.id, names);
      return { ...profileOf(ctx.node), ...names, configured: true };
    },

    'auth.login': async ({ email, password }, ctx) => {
      const key = email.trim().toLowerCase();
      const now = deps.now().getTime();
      if (throttle.blocked(key, now)) fail('invalid-credentials', msg('auth.tooManyAttempts'));
      const user = await store.getUserByEmail(key);
      // Same answer for "no such user" and "wrong password" (no account discovery).
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throttle.failed(key, now);
        return fail('invalid-credentials', msg('auth.invalidCredentials'));
      }
      throttle.succeeded(key);
      if (!user.active) fail('permission-denied', msg('account.inactive'));
      // Only administrators sign in: scanning needs no sign-in on a paired station.
      if (user.role !== 'admin') fail('permission-denied', msg('auth.adminOnly'));
      const session = newToken();
      const idleMinutes = await adminIdleMinutes(store);
      const expiresAt = new Date(now + idleMinutes * 60_000).toISOString();
      await store.deleteExpiredSessions(iso());
      await store.createSession(hashToken(session), {
        userId: user.uid,
        nodeId: ctx.node.id,
        createdAt: iso(),
        expiresAt,
      });
      return { session, uid: user.uid, email: user.email, idleMinutes };
    },

    'auth.logout': async (_in, ctx) => {
      if (ctx.sessionHash) await store.deleteSession(ctx.sessionHash);
      return null;
    },

    me: async (_in, ctx) => {
      const { passwordHash: _h, ...user } = ctx.user as StoredUser;
      void _h;
      return user;
    },

    'prefs.save': async ({ language, theme }, ctx) => {
      if (!['en', 'hi', 'mr'].includes(language) || !['light', 'dark'].includes(theme)) {
        fail('invalid-data', msg('errors.generic'));
      }
      await store.setUserPreferences(actorOf(ctx).uid, language, theme);
      return null;
    },

    'serials.register': async (input, ctx): Promise<VerificationResult> => {
      // Registered BY THE STATION (no person signs in): the record carries the station's name and
      // its usual operator (if set), with the server's time.
      const actor: Actor = { uid: ctx.node.id, name: ctx.node.operatorName };
      const serial = normalizeSerial(String(input.serial ?? ''));
      if (!serial)
        return { result: 'invalid', serial, reason: 'empty', ...text(msg('verify.empty')) };
      if (!input.companyId) {
        return {
          result: 'invalid',
          serial,
          reason: 'no-company',
          ...text(msg('verify.noCompany')),
        };
      }
      if (input.source !== 'manual' && input.source !== 'scan')
        fail('invalid-data', msg('errors.generic'));
      const company = await store.getCompany(input.companyId);
      const refused = checkSerialForCompany(serial, company);
      if (refused || !company) {
        return (
          refused ?? {
            result: 'error',
            code: 'company-unavailable',
            ...text(msg('verify.companyUnavailable')),
          }
        );
      }
      const partNo = (input.partNo ?? '').trim().slice(0, MAX_PART_LENGTH);
      // Network-split rule: never register on two main computers at once.
      const state = await cluster.registerState();
      if (state === 'not-main') {
        return { result: 'error', code: 'not-main', ...text(msg('cluster.notMain')) };
      }
      if (state !== 'ok') return { result: 'error', code: 'paused', ...text(pausedMsg(state)) };
      const outcome = await store.registerSerial({
        serial,
        partNo,
        company: { id: company.id, name: company.name },
        source: input.source,
        actor,
        station: stationOf(ctx),
        now: iso(),
      });
      const log = outcome.log;
      // On the backup before the station shows "new" (when the backup is connected; max 2 s).
      await cluster.confirm(store.replLastSeq());
      deps.broadcast({ type: 'scan', scan: log });
      if (outcome.result === 'new') {
        return {
          result: 'new',
          serial,
          company,
          partNo,
          source: input.source,
          scannedBy: actor.uid,
          scannedByName: actor.name,
          scannedAt: log.timestamp ?? iso(),
          nodeName: ctx.node.name,
        };
      }
      return {
        result: 'duplicate',
        serial,
        company,
        existingRecord: outcome.existing,
        currentAttempt: {
          scannedBy: actor.uid,
          scannedByName: actor.name,
          timestamp: log.timestamp ?? iso(),
          nodeName: ctx.node.name,
        },
      };
    },

    'scans.recent': async ({ count }) =>
      store.recentScans(Math.min(Math.max(1, Math.floor(Number(count) || 20)), 100)),

    'scans.history': async ({ filters, after }) => {
      const page = await store.scanHistory(filters, after, HISTORY_PAGE_SIZE);
      const serials = await store.findSerials(
        page.entries.map((e) => ({ companyId: e.companyId, serial: e.serial })),
      );
      const partNumbers: Record<string, string> = {};
      for (const s of serials) partNumbers[s.serial] = s.partNo;
      const last = page.entries[page.entries.length - 1];
      return {
        entries: page.entries.map(({ seq: _s, ...l }) => (void _s, l)),
        partNumbers,
        cursor: page.hasMore && last ? last.seq : null,
        hasMore: page.hasMore,
      };
    },

    'companies.active': async () => store.listCompanies(true),
    'companies.all': async () => store.listCompanies(false),
    'companies.create': async ({ input }, ctx) => {
      const c = companyFromInput(input);
      const id = companyIdFromName(c.name);
      if (!id) fail('invalid-data', msg('companies.idInvalid'));
      const created = await store.createCompany({ id, ...c }, actorOf(ctx), iso());
      if (!created) fail('invalid-data', msg('companies.idExists', { id }));
      return id;
    },
    'companies.update': async ({ id, input }, ctx) => {
      if (!(await store.getCompany(id))) fail('not-found', msg('errors.notFound'));
      await store.updateCompany(id, companyFromInput(input), actorOf(ctx), iso());
      return null;
    },

    'users.list': async () => store.listUsers(),
    'users.create': async (input) => {
      validNewUser(input);
      const email = input.email.trim().toLowerCase();
      if (await store.getUserByEmail(email)) fail('invalid-data', msg('users.emailExists'));
      await store.createUser({
        id: newId(),
        email,
        name: input.name.trim(),
        role: input.role,
        passwordHash: await hashPassword(input.password),
        now: iso(),
      });
      return null;
    },
    'users.setPassword': async ({ uid, password }, ctx) => {
      validPassword(password);
      if (!(await store.getUserById(uid))) fail('not-found', msg('errors.notFound'));
      await store.setUserPassword(uid, await hashPassword(password), actorOf(ctx), iso());
      await store.deleteSessionsForUser(uid); // signs the person out everywhere
      deps.sessionsEnded(uid);
      return null;
    },
    'users.change': async ({ uid, change }, ctx) => {
      const actor = actorOf(ctx);
      const users = await store.listUsers();
      const target = users.find((u) => u.uid === uid);
      if (!target) return fail('not-found', msg('errors.notFound'));
      const safeChange = {
        ...(change.role === 'admin' || change.role === 'operator' ? { role: change.role } : {}),
        ...(typeof change.active === 'boolean' ? { active: change.active } : {}),
      };
      const check = checkUserChange({ actorUid: actor.uid, target, change: safeChange, users });
      if (!check.ok) fail('invalid-data', check.msg);
      await store.updateUserRoleActive(uid, safeChange, actor, iso());
      // A changed role or a deactivation applies at once: their sessions end.
      await store.deleteSessionsForUser(uid);
      deps.sessionsEnded(uid);
      deps.broadcast({ type: 'user-changed', uid });
      return null;
    },

    counts: async ({ metric, companyId, start, end }) => {
      switch (metric) {
        case 'serials':
          return store.countSerials();
        case 'serialsForCompany':
          return store.countSerialsForCompany(companyId ?? '');
        case 'serialsRegisteredBetween':
          return store.countSerialsBetween(start ?? '', end ?? '');
        case 'duplicateAttemptsBetween':
          return store.countDuplicatesBetween(start ?? '', end ?? '');
        case 'companies':
          return store.countCompanies(false);
        case 'activeCompanies':
          return store.countCompanies(true);
        case 'activeOperators':
          return store.countActiveOperators();
      }
      return fail('invalid-data', msg('errors.generic'));
    },

    'import.preview': async ({ filename, sheetName, sheets, rows }) => {
      const companies = await store.listCompanies(false);
      const normalized = normalizeRows(rows, companies, companySerialKey);
      const found = await store.findSerials(
        normalized.rows
          .filter((r) => r.cls === 'new')
          .map((r) => ({ companyId: r.companyId, serial: r.serial })),
      );
      const existing = new Map<string, ExistingSerialInfo>(
        found.map((s) => [
          companySerialKey(s),
          { serial: s.serial, company: s.company, companyId: s.companyId, partNo: s.partNo },
        ]),
      );
      const classified = classifyAgainstFirestore(normalized, existing, companySerialKey);
      return { filename, sheetName, sheets, rows: classified, counts: countRows(classified) };
    },

    'import.confirm': async ({ preview }, ctx) => {
      const actor = actorOf(ctx);
      await mayRegister();
      const at = iso();
      // Never trust the preview sent back: every NEW row is re-checked against the database rules.
      const companies = new Map((await store.listCompanies(false)).map((c) => [c.id, c]));
      const toCreate: ClassifiedRow[] = [];
      /** Row to write -> the preview row it came from (keys of `items`). */
      const fromPreview = new Map<ClassifiedRow, ClassifiedRow>();
      // What happened to each row of the file (Import history > details).
      const items = new Map<ClassifiedRow, ImportItem>();
      const item = (r: ClassifiedRow, outcome: ImportItemOutcome, reason?: Msg): ImportItem => ({
        rowNumber: Number(r.rowNumber) || 0,
        sheet: String(r.sheet ?? '').slice(0, 100),
        serial: String(r.serial ?? '').slice(0, 100),
        companyName: String(r.companyName ?? '').slice(0, 200),
        partNo: String(r.partNo ?? '').slice(0, 200),
        outcome,
        ...(reason
          ? { reason: enText(reason), reasonMsg: reason }
          : {
              reason: String(r.reason ?? '').slice(0, 300),
              ...(r.reasonMsg ? { reasonMsg: r.reasonMsg } : {}),
            }),
      });
      let invalid = preview.counts.invalid;
      for (const r of preview.rows) {
        if (r.cls !== 'new') {
          const outcome: ImportItemOutcome = r.cls === 'existing' ? 'skipped' : r.cls;
          items.set(r, item(r, outcome));
          continue;
        }
        const company = companies.get(r.companyId);
        const serial = normalizeSerial(String(r.serial ?? ''));
        const partNo = String(r.partNo ?? '').trim();
        if (
          !company?.active ||
          !serial ||
          serialValueProblem(serial) ||
          partNo.length > MAX_PART_LENGTH
        ) {
          invalid += 1;
          items.set(r, item(r, 'invalid', msg('importDetails.recheckFailed')));
          continue;
        }
        const row = { ...r, serial, partNo, companyName: company.name };
        toCreate.push(row);
        fromPreview.set(row, r);
        items.set(r, item(row, 'added'));
      }
      const outcome: ImportOutcome = {
        filename: preview.filename,
        status: 'completed',
        error: '',
        totalRows: preview.counts.total,
        created: 0,
        skipped: preview.counts.existing,
        conflicts: preview.counts.conflict,
        duplicates: preview.counts.duplicate,
        invalid,
        notProcessed: 0,
        raceSkipped: 0,
        raceConflicts: 0,
      };
      // The history row first, so the added serials can point to their file.
      let importId: number | null = null;
      try {
        importId = await store.startImport({
          filename: preview.filename.slice(0, 255),
          by: actor,
          at,
        });
      } catch {
        // History not recorded (reported below); the serials are still imported.
      }
      try {
        const result = await store.importSerials(
          toCreate.map((r) => ({
            serial: r.serial,
            partNo: r.partNo,
            companyId: r.companyId,
            companyName: r.companyName,
          })),
          actor,
          stationOf(ctx),
          at,
          importId,
        );
        outcome.created = result.created;
        // Registered by someone else since the preview: left untouched, reported.
        for (const ex of result.existing) {
          const row = toCreate.find((r) => r.companyId === ex.companyId && r.serial === ex.serial);
          const same = row && compareWithExisting(row, { ...ex, company: ex.company }).compatible;
          if (same) {
            outcome.skipped++;
            outcome.raceSkipped++;
          } else {
            outcome.conflicts++;
            outcome.raceConflicts++;
          }
          const key = row && fromPreview.get(row);
          if (key && row) {
            items.set(
              key,
              same
                ? item(row, 'skipped', msg('importDetails.raceSame'))
                : item(row, 'conflict', msg('importDetails.raceConflict')),
            );
          }
        }
      } catch (e) {
        const m = msg('import.stoppedUnexpectedly');
        outcome.status = 'failed';
        outcome.error = enText(m);
        outcome.errorMsg = m;
        outcome.notProcessed = toCreate.length;
        for (const [key, it] of items) {
          if (it.outcome === 'added') {
            items.set(key, { ...it, outcome: 'skipped', reason: enText(m), reasonMsg: m });
          }
        }
        void e;
      }
      let historyRecorded = importId !== null;
      if (importId !== null) {
        try {
          await store.finishImport(
            importId,
            {
              totalRows: outcome.totalRows,
              newCount: outcome.created,
              skipped: outcome.skipped,
              conflicts: outcome.conflicts,
              duplicates: outcome.duplicates,
              invalid: outcome.invalid,
              status: outcome.status,
              error: outcome.error.slice(0, 300),
            },
            [...items.values()],
          );
        } catch {
          historyRecorded = false;
        }
      }
      await cluster.confirm(store.replLastSeq());
      return { outcome, historyRecorded };
    },
    'import.details': async ({ importId }) => {
      const id = Number(importId);
      const details = Number.isSafeInteger(id) ? await store.importDetails(id) : null;
      if (!details) return fail('not-found', msg('importDetails.notFound'));
      return { importId: String(id), ...details };
    },

    'serials.search': async ({ query }) => {
      const prefix = normalizeSerial(String(query ?? '')).slice(0, 100);
      if (!prefix) return [];
      const records = await store.searchSerials(prefix, SEARCH_LIMIT);
      const companies = new Map((await store.listCompanies(false)).map((c) => [c.id, c]));
      return records.map((record) => ({
        record,
        company: companies.get(record.companyId) ?? null,
      }));
    },
    'labels.reprint': async ({ companyId, serial }, ctx) => {
      // Admin only (OP_ACCESS): a reprint is never a way to label a second product.
      const actor = actorOf(ctx);
      const [record] = await store.findSerials([
        { companyId: String(companyId ?? ''), serial: normalizeSerial(String(serial ?? '')) },
      ]);
      if (!record) return fail('not-found', msg('findSerial.notRegistered'));
      const company = await store.getCompany(record.companyId);
      if (!company) return fail('not-found', msg('verify.companyUnavailable'));
      await store.logReprint(record, actor, stationOf(ctx), iso());
      return { record, company };
    },
    'import.history': async ({ count }) => store.importHistory(Math.min(count, 100)),

    'export.data': async () => ({
      serials: await store.allSerialsForExport(),
      companies: await store.listCompanies(false),
    }),
    'export.record': async ({ filename, recordCount }, ctx) => {
      const actor = actorOf(ctx);
      await store.addExportHistory({
        filename: String(filename).slice(0, 255),
        exportedBy: actor.uid,
        exportedByName: actor.name,
        exportedAt: iso(),
        recordCount: Math.max(0, Math.floor(Number(recordCount) || 0)),
      });
      return null;
    },
    'export.history': async ({ count }) => store.exportHistory(Math.min(count, 100)),

    'nodes.list': async () => store.listNodes(),
    'nodes.revoke': async ({ nodeId }) => {
      if (!(await store.revokeNode(nodeId, iso())))
        fail('invalid-data', msg('stations.cannotRemove'));
      await store.deleteSessionsForNode(nodeId);
      cluster.stationRemoved(nodeId);
      deps.disconnectNode(nodeId);
      return null;
    },
    'nodes.update': async (input) => {
      const names = stationNames(input);
      if (!(await store.updateNode(input.nodeId, names))) fail('not-found', msg('errors.notFound'));
      deps.broadcast({ type: 'station-changed', nodeId: input.nodeId });
      return null;
    },
    'settings.get': async () => ({ adminIdleMinutes: await adminIdleMinutes(store) }),
    'settings.set': async ({ adminIdleMinutes: minutes }) => {
      const m = Number(minutes);
      if (!(Number.isInteger(m) && m >= 1 && m <= MAX_ADMIN_IDLE_MINUTES)) {
        fail('invalid-data', msg('stations.adminIdleInvalid', { max: MAX_ADMIN_IDLE_MINUTES }));
      }
      await store.setMeta('admin_idle_minutes', String(m));
      return null;
    },

    // ---- backup main computer ----
    'cluster.status': async () => cluster.status(),
    'cluster.setBackup': async ({ nodeId }) => {
      if (cluster.role !== 'main') notMain();
      if (!(await cluster.setBackup(String(nodeId ?? '')))) {
        fail('invalid-data', msg('cluster.cannotBeBackup'));
      }
      return null;
    },
    'cluster.registerBackup': async ({ certPem }, ctx) => {
      if (!cluster.registerBackupCert(ctx.node.id, String(certPem ?? ''))) {
        fail('permission-denied', msg('auth.noPermission'));
      }
      return null;
    },
    'cluster.stepDown': async ({ term }, ctx) => {
      if (cluster.role !== 'main') notMain();
      try {
        return cluster.stepDown(ctx.node.id, Number(term));
      } catch {
        return fail('permission-denied', msg('auth.noPermission'));
      }
    },
    'cluster.handover': async ({ records }) => {
      await mayRegister();
      const safe = {
        serials: Array.isArray(records?.serials) ? records.serials : [],
        scanLog: Array.isArray(records?.scanLog) ? records.scanLog : [],
        imports: Array.isArray(records?.imports) ? records.imports : [],
      };
      const result = await store.mergeHandover(safe, iso());
      await cluster.confirm(store.replLastSeq());
      deps.broadcast({ type: 'cluster-changed' });
      return result;
    },
    'cluster.clearConflicts': async () => {
      await store.clearConflicts();
      deps.broadcast({ type: 'cluster-changed' });
      return null;
    },

    // ---- forgotten admin password ----
    'auth.recover': async ({ email, code, newPassword }, ctx) => {
      // On the main computer itself only (never from another station on the network).
      if (!(ctx.local && ctx.node.isServer)) fail('permission-denied', msg('stations.serverOnly'));
      const now = deps.now().getTime();
      if (recoveryThrottle.blocked('recovery', now)) {
        fail('invalid-credentials', msg('auth.tooManyAttempts'));
      }
      const user = await store.getUserByEmail(
        String(email ?? '')
          .trim()
          .toLowerCase(),
      );
      if (
        !user ||
        user.role !== 'admin' ||
        !user.active ||
        !(await checkRecoveryCode(store, String(code ?? '')))
      ) {
        recoveryThrottle.failed('recovery', now);
        return fail('invalid-credentials', msg('recovery.wrong'));
      }
      recoveryThrottle.succeeded('recovery');
      validPassword(String(newPassword ?? ''));
      await store.setUserPassword(
        user.uid,
        await hashPassword(String(newPassword)),
        { uid: user.uid, name: user.name },
        iso(),
      );
      await store.deleteSessionsForUser(user.uid);
      // Used once: a new code replaces it.
      return { recoveryCode: await issueRecoveryCode(store) };
    },
    'recovery.regenerate': async () => ({ recoveryCode: await issueRecoveryCode(store) }),

    'pairing.open': async () => deps.pairing.open(),
    'pairing.status': async () => deps.pairing.status(),
    'pairing.close': async () => {
      deps.pairing.close();
      return null;
    },
  };
}

/** First-run setup on the server computer (never reachable over the network). */
export async function createFirstAdmin(
  store: Store,
  input: { name: string; email: string; password: string },
  now: string,
): Promise<User> {
  if ((await store.countUsers()) > 0) fail('invalid-data', msg('setup.adminExists'));
  validNewUser({ ...input, role: 'admin' });
  const id = newId();
  await store.createUser({
    id,
    email: input.email.trim().toLowerCase(),
    name: input.name.trim(),
    role: 'admin',
    passwordHash: await hashPassword(input.password),
    now,
  });
  const { passwordHash: _h, ...user } = (await store.getUserById(id)) as StoredUser;
  void _h;
  return user;
}
