// Emulator-backed Phase 9 services against the real security rules.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countActiveCompanies,
  countActiveOperators,
  countCompanies,
  countDuplicateAttemptsBetween,
  countSerials,
  countSerialsForCompany,
  countSerialsRegisteredBetween,
} from '../src/services/admin/dashboardService';
import { getScanHistoryPage } from '../src/services/admin/scanHistoryService';
import { getExportHistory, recordExportHistory } from '../src/services/admin/exportHistoryService';
import {
  createCompany,
  getAllCompanies,
  updateCompany,
} from '../src/services/companies/companyAdminService';
import { applyUserChange, getAllUsers } from '../src/services/users/userAdminService';

let env: RulesTestEnvironment;
const db = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const actor = { uid: 'admin1', name: 'Ada' };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-vicimus',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => env.cleanup());

const NOW = new Date();
const minutesAgo = (m: number) => Timestamp.fromDate(new Date(NOW.getTime() - m * 60_000));
const TOTAL_LOGS = 70;

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const u = (name: string, role: string, active = true) => ({
      name,
      email: `${name}@x`,
      role,
      active,
      created_at: new Date(),
    });
    await setDoc(doc(d, 'users/admin1'), u('Ada', 'admin'));
    await setDoc(doc(d, 'users/admin2'), u('Bea', 'admin'));
    await setDoc(doc(d, 'users/op1'), u('Oli', 'operator'));
    await setDoc(doc(d, 'users/op2'), u('Omar', 'operator'));
    await setDoc(doc(d, 'users/off1'), u('Off', 'operator', false));
    await setDoc(doc(d, 'companies/company-a'), {
      name: 'Company A',
      code_type: 'barcode',
      serial_format: 'A#',
      active: true,
    });
    await setDoc(doc(d, 'companies/company-b'), {
      name: 'Company B',
      code_type: 'qr',
      serial_format: 'B#',
      active: false,
    });
    const b = writeBatch(d);
    // 10 serials: 6 registered today (company A), 4 old (company B)
    for (let i = 0; i < 10; i++) {
      const today = i < 6;
      b.set(doc(d, `serials/S${i}`), {
        serial: `S${i}`,
        part_no: `P${i}`,
        company: today ? 'Company A' : 'Company B',
        company_id: today ? 'company-a' : 'company-b',
        source: 'manual',
        scanned_at: today ? minutesAgo(i) : Timestamp.fromDate(new Date(2020, 0, 1 + i)),
        scanned_by: 'op1',
        scanned_by_name: 'Oli',
      });
    }
    await b.commit();
    // 70 logs, newest first by index: every 5th is a duplicate, alternating operator and source
    const batch = writeBatch(d);
    for (let i = 0; i < TOTAL_LOGS; i++) {
      batch.set(doc(d, `scan_log/L${String(i).padStart(3, '0')}`), {
        serial: `S${i % 10}`,
        result: i % 5 === 0 ? 'duplicate' : 'new',
        company: i % 2 ? 'Company B' : 'Company A',
        company_id: i % 2 ? 'company-b' : 'company-a',
        source: i % 3 ? 'scan' : 'manual',
        scanned_by: i % 2 ? 'op2' : 'op1',
        scanned_by_name: i % 2 ? 'Omar' : 'Oli',
        timestamp: minutesAgo(i + 1),
      });
    }
    await batch.commit();
  });
});

const dayStart = () => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
const dayEnd = () => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1);

describe('dashboard counts (server-side aggregation)', () => {
  it('match the data exactly', async () => {
    const a = db('admin1');
    expect(await countSerials(a)).toBe(10);
    expect(await countCompanies(a)).toBe(2);
    expect(await countActiveCompanies(a)).toBe(1);
    expect(await countActiveOperators(a)).toBe(2);
    expect(await countSerialsForCompany('company-a', a)).toBe(6);
    expect(await countSerialsForCompany('company-b', a)).toBe(4);
  });
  it('count today only (local day), including duplicate attempts', async () => {
    const a = db('admin1');
    expect(await countSerialsRegisteredBetween(dayStart(), dayEnd(), a)).toBeLessThanOrEqual(6);
    expect(await countSerialsRegisteredBetween(new Date(2019, 0, 1), new Date(2021, 0, 1), a)).toBe(
      4,
    );
    expect(await countDuplicateAttemptsBetween(new Date(2000, 0, 1), dayEnd(), a)).toBe(14);
    expect(await countDuplicateAttemptsBetween(new Date(2000, 0, 1), new Date(2001, 0, 1), a)).toBe(
      0,
    );
  });
  it('operators cannot count users or all serials', async () => {
    await expect(countSerials(db('op1'))).rejects.toBeTruthy();
    await expect(countActiveOperators(db('op1'))).rejects.toBeTruthy();
  });
});

describe('scan history paging and filters', () => {
  it('pages through all logs without gaps or duplicates, newest first', async () => {
    const a = db('admin1');
    const seen: string[] = [];
    let cursor = null;
    let pages = 0;
    for (;;) {
      const p: Awaited<ReturnType<typeof getScanHistoryPage>> = await getScanHistoryPage(
        {},
        cursor,
        25,
        a,
      );
      pages++;
      seen.push(...p.entries.map((e) => e.id));
      if (!p.hasMore) break;
      cursor = p.cursor;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(TOTAL_LOGS);
    expect(new Set(seen).size).toBe(TOTAL_LOGS);
    expect(seen[0]).toBe('L000'); // newest first
  });
  it('first page is limited, not the whole collection', async () => {
    const p = await getScanHistoryPage({}, null, 25, db('admin1'));
    expect(p.entries).toHaveLength(25);
    expect(p.hasMore).toBe(true);
  });
  it('includes the current part number of each serial', async () => {
    const p = await getScanHistoryPage({}, null, 5, db('admin1'));
    expect(p.entries[0]?.serial).toBe('S0');
    expect(p.partNumbers.get('S0')).toBe('P0');
  });
  it('filters by result, company, source, operator and date range (and combinations)', async () => {
    const a = db('admin1');
    const all = async (f: Parameters<typeof getScanHistoryPage>[0]) =>
      (await getScanHistoryPage(f, null, 100, a)).entries;
    expect(await all({ result: 'duplicate' })).toHaveLength(14);
    expect(await all({ companyId: 'company-b' })).toHaveLength(35);
    expect(await all({ scannedBy: 'op1' })).toHaveLength(35);
    expect((await all({ source: 'manual' })).every((e) => e.source === 'manual')).toBe(true);
    const combo = await all({ result: 'duplicate', companyId: 'company-a', source: 'manual' });
    expect(
      combo.every(
        (e) => e.result === 'duplicate' && e.company === 'Company A' && e.source === 'manual',
      ),
    ).toBe(true);
    const range = await all({
      from: new Date(NOW.getTime() - 10.5 * 60_000),
      to: new Date(NOW.getTime() - 4.5 * 60_000),
    });
    expect(range.map((e) => e.id)).toEqual(['L004', 'L005', 'L006', 'L007', 'L008', 'L009']);
    expect(await all({ result: 'duplicate', from: dayEnd() })).toEqual([]);
  });
  it('signed-out access is denied', async () => {
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    await expect(getScanHistoryPage({}, null, 5, anon)).rejects.toBeTruthy();
  });
});

describe('company administration', () => {
  it('creates, edits (code type barcode -> qr) and deactivates, attributed; serials unchanged', async () => {
    const a = db('admin1');
    const id = await createCompany(
      { name: 'Delta Corp', codeType: 'barcode', serialFormat: 'D#####', active: true },
      actor,
      a,
    );
    expect(id).toBe('delta-corp');
    await expect(
      createCompany(
        { name: 'Delta Corp', codeType: 'qr', serialFormat: 'X#', active: true },
        actor,
        a,
      ),
    ).rejects.toThrow(/already exists/);

    const serialBefore = (await getDoc(doc(a, 'serials/S0'))).data();
    await updateCompany(
      'company-a',
      { name: 'Company A', codeType: 'qr', serialFormat: 'A#', active: true },
      actor,
      a,
    );
    await updateCompany(
      id,
      { name: 'Delta Corp', codeType: 'barcode', serialFormat: 'D#####', active: false },
      actor,
      a,
    );
    const list = await getAllCompanies(a);
    expect(list.find((c) => c.id === 'company-a')?.codeType).toBe('qr');
    const delta = list.find((c) => c.id === id);
    expect(delta?.active).toBe(false);
    expect(delta?.updatedByName).toBe('Ada');
    expect((await getDoc(doc(a, 'serials/S0'))).data()).toEqual(serialBefore);
  });
  it('rejects invalid input before writing, and operators cannot write', async () => {
    await expect(
      createCompany(
        { name: '', codeType: '', serialFormat: '', active: true },
        actor,
        db('admin1'),
      ),
    ).rejects.toThrow();
    await expect(
      updateCompany(
        'company-a',
        { name: 'X', codeType: 'qr', serialFormat: 'X#', active: true },
        { uid: 'op1', name: 'Oli' },
        db('op1'),
      ),
    ).rejects.toThrow();
  });
});

describe('user administration', () => {
  it('lists users and changes another user with attribution', async () => {
    const a = db('admin1');
    const users = await getAllUsers(a);
    expect(users.map((x) => x.uid).sort()).toEqual(['admin1', 'admin2', 'off1', 'op1', 'op2']);
    const op1 = users.find((x) => x.uid === 'op1')!;
    await applyUserChange({ target: op1, change: { active: false }, users }, actor, a);
    await applyUserChange({ target: op1, change: { role: 'admin' }, users }, actor, a);
    const after = (await getAllUsers(a)).find((x) => x.uid === 'op1')!;
    expect(after).toMatchObject({ active: false, role: 'admin', updatedByName: 'Ada' });
  });
  it('refuses own-account changes and last-admin removal; rules agree', async () => {
    const a = db('admin1');
    const users = await getAllUsers(a);
    const me = users.find((x) => x.uid === 'admin1')!;
    await expect(
      applyUserChange({ target: me, change: { active: false }, users }, actor, a),
    ).rejects.toThrow(/own/);
    // bypass the UI check: the rules still refuse a self change
    const { updateDoc } = await import('firebase/firestore');
    await expect(
      updateDoc(doc(a, 'users/admin1'), {
        active: false,
        updated_by: 'admin1',
        updated_by_name: 'Ada',
        updated_at: new Date(),
      }),
    ).rejects.toBeTruthy();
  });
  it('an inactive user is locked out of application data', async () => {
    await expect(countSerials(db('off1'))).rejects.toBeTruthy();
    await expect(getAllCompanies(db('off1'))).rejects.toBeTruthy();
  });
});

describe('export history', () => {
  it('records who/when/how many and lists newest first (limited)', async () => {
    const a = db('admin1');
    await recordExportHistory({ filename: 'one.xlsx', recordCount: 3 }, actor, a);
    await new Promise((r) => setTimeout(r, 20));
    await recordExportHistory({ filename: 'two.xlsx', recordCount: 10 }, actor, a);
    const list = await getExportHistory(20, a);
    expect(list.map((e) => e.filename)).toEqual(['two.xlsx', 'one.xlsx']);
    expect(list[0]).toMatchObject({ exportedByName: 'Ada', exportedBy: 'admin1', recordCount: 10 });
    expect(await getExportHistory(1, a)).toHaveLength(1);
  });
  it('operators cannot read or write it', async () => {
    await expect(getExportHistory(5, db('op1'))).rejects.toBeTruthy();
    await expect(
      recordExportHistory(
        { filename: 'x.xlsx', recordCount: 1 },
        { uid: 'op1', name: 'Oli' },
        db('op1'),
      ),
    ).rejects.toBeTruthy();
  });
});
