// Emulator-backed tests of the Excel import: preview, safe creation, idempotency, races, rules.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { confirmImport, previewImport } from '../src/services/excel/importService';
import { verifySerial } from '../src/services/serial/serialVerification';
import type { Company } from '../src/types';
import { makeXlsx, STD_HEADERS } from './helpers';

let env: RulesTestEnvironment;
const ADMIN = { uid: 'admin1', name: 'Ada Admin' };
const db = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-vicimus',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const user = (name: string, role: string) => ({
      name,
      email: `${name}@x`,
      role,
      active: true,
      created_at: new Date(),
    });
    await setDoc(doc(d, 'users/admin1'), user('Ada Admin', 'admin'));
    await setDoc(doc(d, 'users/admin2'), user('Bo Admin', 'admin'));
    await setDoc(doc(d, 'users/op1'), user('Oli Operator', 'operator'));
    for (const [id, name, ct] of [
      ['company-a', 'Company A', 'barcode'],
      ['company-b', 'Company B', 'qr'],
    ]) {
      await setDoc(doc(d, 'companies', id), {
        name,
        code_type: ct,
        serial_format: '',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
    const existing = (serial: string, cid: string, cname: string, part: string) =>
      setDoc(doc(d, 'serials', serial), {
        serial,
        part_no: part,
        company: cname,
        company_id: cid,
        source: 'manual',
        scanned_at: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
        scanned_by: 'op1',
        scanned_by_name: 'Oli Operator',
      });
    await existing('13WAA000000001', 'company-a', 'Company A', '');
    await existing('27BXX0000001', 'company-b', 'Company B', 'PN-200');
  });
});

const rawDoc = async (serial: string) => {
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), 'serials', serial))).data();
  });
  return data;
};
const count = async (name: string) => {
  let n = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    n = (await getDocs(collection(ctx.firestore(), name))).size;
  });
  return n;
};

const FIXTURE = [
  ['13WAA000010001', 'PN-100', 'Company A'], // new
  ['13WAA000010002', 'PN-101', 'Company A'], // new
  ['27BXX0010001', 'PN-300', 'Company B'], // new
  ['13WAA000000001', '', 'Company A'], // existing
  ['13WAA000000001', 'PN-99', 'Company A'], // duplicate within upload
  ['27BXX0000001', 'PN-200', 'Company A'], // conflict (company)
  ['', 'PN-1', 'Company A'], // invalid
  ['13WAA000010003', 'PN-102', 'No Such Company'], // invalid
];

describe('preview (no writes)', () => {
  it('classifies the fixture: 3 new, 1 existing, 1 duplicate, 1 conflict, 2 invalid', async () => {
    const before = await count('serials');
    const p = await previewImport(
      db('admin1'),
      await makeXlsx(STD_HEADERS, FIXTURE),
      'fixture.xlsx',
    );
    expect(p.counts).toEqual({
      total: 8,
      valid: 6,
      new: 3,
      existing: 1,
      conflict: 1,
      duplicate: 1,
      invalid: 2,
    });
    const conflict = p.rows.find((r) => r.cls === 'conflict')!;
    expect(conflict).toMatchObject({
      serial: '27BXX0000001',
      existing: { company: 'Company B', partNo: 'PN-200' },
    });
    expect(conflict.reason).toContain('Company differs (file: Company A, Firestore: Company B)');
    expect(p.rows.find((r) => r.cls === 'duplicate')).toMatchObject({
      rowNumber: 6,
      duplicateOfRow: 5,
    });
    expect(await count('serials')).toBe(before); // preview wrote nothing
    expect(await count('import_history')).toBe(0);
  });

  it('missing required column: rejected before ANY Firestore access', async () => {
    const poisoned = new Proxy(
      {},
      {
        get() {
          throw new Error('Firestore must not be touched');
        },
      },
    ) as unknown as Firestore;
    const buf = await makeXlsx(['Serial Number', 'Company'], [['A-1', 'Company A']]);
    await expect(previewImport(poisoned, buf, 'x.xlsx')).rejects.toThrow(
      /Missing required column.*Part Number/,
    );
  });

  it('looks serials up by ID in chunks (95 serials, 30 per query) and finds only the existing ones', async () => {
    const rows = Array.from({ length: 95 }, (_, i) => [
      `BULK-${String(i).padStart(3, '0')}`,
      '',
      'Company A',
    ]);
    rows.push(['13WAA000000001', '', 'Company A'], ['27BXX0000001', 'PN-200', 'Company B']);
    const p = await previewImport(db('admin1'), await makeXlsx(STD_HEADERS, rows), 'bulk.xlsx');
    expect(p.counts).toMatchObject({ total: 97, new: 95, existing: 2 });
  });
});

describe('import (safe creation)', () => {
  it('creates ONLY the new rows, with source "excel", server timestamps and the admin as importer', async () => {
    const d = db('admin1');
    const preview = await previewImport(d, await makeXlsx(STD_HEADERS, FIXTURE), 'fixture.xlsx');
    const { outcome, historyRecorded } = await confirmImport(d, preview, ADMIN);
    expect(outcome).toMatchObject({
      status: 'completed',
      created: 3,
      skipped: 1,
      conflicts: 1,
      duplicates: 1,
      invalid: 2,
      totalRows: 8,
    });
    expect(historyRecorded).toBe(true);

    expect(await count('serials')).toBe(2 + 3);
    const created = (await rawDoc('13WAA000010001'))!;
    expect(created).toMatchObject({
      serial: '13WAA000010001',
      part_no: 'PN-100',
      company: 'Company A',
      company_id: 'company-a',
      source: 'excel',
      scanned_by: 'admin1',
      scanned_by_name: 'Ada Admin',
    });
    expect(typeof (created.scanned_at as Timestamp).toDate).toBe('function'); // server timestamp
    expect(await rawDoc('13WAA000010003')).toBeUndefined(); // invalid row not written
    expect(await count('scan_log')).toBe(0); // import is not a scan
  });

  it('NEVER overwrites: the conflict example keeps the Firestore values', async () => {
    const d = db('admin1');
    const before = await rawDoc('27BXX0000001');
    const preview = await previewImport(
      d,
      await makeXlsx(STD_HEADERS, [['27BXX0000001', 'PART-99', 'Company A']]),
      'c.xlsx',
    );
    expect(preview.counts.conflict).toBe(1);
    const { outcome } = await confirmImport(d, preview, ADMIN);
    expect(outcome.created).toBe(0);
    expect(await rawDoc('27BXX0000001')).toEqual(before);
  });

  it('records a history entry with counts, status, importer and server time (no workbook stored)', async () => {
    const d = db('admin1');
    const preview = await previewImport(d, await makeXlsx(STD_HEADERS, FIXTURE), 'fixture.xlsx');
    await confirmImport(d, preview, ADMIN);
    let h: Record<string, unknown> = {};
    await env.withSecurityRulesDisabled(async (ctx) => {
      h = (await getDocs(collection(ctx.firestore(), 'import_history'))).docs[0]!.data();
    });
    expect(h).toMatchObject({
      filename: 'fixture.xlsx',
      imported_by: 'admin1',
      imported_by_name: 'Ada Admin',
      total_rows: 8,
      new: 3,
      skipped: 1,
      conflicts: 1,
      duplicates: 1,
      invalid: 2,
      status: 'completed',
    });
    expect(typeof (h.imported_at as Timestamp).toDate).toBe('function');
    expect(Object.keys(h).sort()).toEqual([
      'conflicts',
      'duplicates',
      'filename',
      'imported_at',
      'imported_by',
      'imported_by_name',
      'invalid',
      'new',
      'skipped',
      'status',
      'total_rows',
    ]);
  });
});

describe('idempotency', () => {
  it('same 100-row file twice: 100 NEW then 0 NEW + 100 EXISTING, exactly 100 records, no overwrite', async () => {
    const buf = await makeXlsx(
      STD_HEADERS,
      Array.from({ length: 100 }, (_, i) => [
        `IDEM-${String(i).padStart(3, '0')}`,
        `PN-${i}`,
        i % 2 ? 'Company A' : 'Company B',
      ]),
    );
    const d = db('admin1');
    const p1 = await previewImport(d, buf, 'test.xlsx');
    expect(p1.counts).toMatchObject({ total: 100, new: 100, existing: 0 });
    const r1 = await confirmImport(d, p1, ADMIN);
    expect(r1.outcome.created).toBe(100);
    expect(await count('serials')).toBe(102);
    const snapshot = await rawDoc('IDEM-050');

    const p2 = await previewImport(d, buf, 'test.xlsx');
    expect(p2.counts).toMatchObject({ total: 100, new: 0, existing: 100, conflict: 0 });
    const r2 = await confirmImport(d, p2, ADMIN);
    expect(r2.outcome).toMatchObject({ created: 0, skipped: 100 });
    expect(await count('serials')).toBe(102);
    expect(await rawDoc('IDEM-050')).toEqual(snapshot); // untouched, original timestamp kept
    expect(await count('import_history')).toBe(2);
  });
});

describe('race protection (preview says NEW, someone registers before confirm)', () => {
  const manual = (uid: string, name: string) => ({
    db: db(uid),
    loadActor: async () => ({ uid, name }),
    loadCompany: async (id: string) =>
      ({
        id,
        name: id === 'company-a' ? 'Company A' : 'Company B',
        codeType: 'barcode',
        serialFormat: '',
        active: true,
        createdAt: null,
        updatedAt: null,
      }) as Company,
  });

  it('an operator registers it after the preview: import skips it / flags a conflict, never overwrites', async () => {
    const d = db('admin1');
    const buf = await makeXlsx(STD_HEADERS, [
      ['RACE-1', '', 'Company A'], // operator will register this with matching data -> skipped
      ['RACE-2', 'PN-EXCEL', 'Company A'], // operator's record has no part number -> conflict
      ['RACE-3', '', 'Company A'], // untouched -> created
    ]);
    const preview = await previewImport(d, buf, 'race.xlsx');
    expect(preview.counts.new).toBe(3);

    // 10:01 — an operator registers two of them
    const op = manual('op1', 'Oli Operator');
    expect(
      (await verifySerial(op, { serial: 'RACE-1', companyId: 'company-a', source: 'manual' }))
        .result,
    ).toBe('new');
    expect(
      (await verifySerial(op, { serial: 'RACE-2', companyId: 'company-a', source: 'manual' }))
        .result,
    ).toBe('new');
    const op1Doc = await rawDoc('RACE-1');
    const op2Doc = await rawDoc('RACE-2');

    // 10:02 — admin confirms
    const { outcome } = await confirmImport(d, preview, ADMIN);
    expect(outcome).toMatchObject({
      status: 'completed',
      created: 1,
      raceSkipped: 1,
      raceConflicts: 1,
    });
    expect(await rawDoc('RACE-1')).toEqual(op1Doc); // operator's record preserved (source manual)
    expect(await rawDoc('RACE-2')).toEqual(op2Doc);
    expect((await rawDoc('RACE-1'))?.source).toBe('manual');
    expect((await rawDoc('RACE-3'))?.source).toBe('excel');
  });

  it('a manual registration racing the import for the same serial: exactly one record', async () => {
    const d = db('admin1');
    const rows = Array.from({ length: 40 }, (_, i) => [
      `MIX-${String(i).padStart(2, '0')}`,
      '',
      'Company A',
    ]);
    const preview = await previewImport(d, await makeXlsx(STD_HEADERS, rows), 'mix.xlsx');
    const op = manual('op1', 'Oli Operator');
    const [imp, ...manuals] = await Promise.all([
      confirmImport(d, preview, ADMIN),
      ...['MIX-03', 'MIX-17', 'MIX-33'].map((s) =>
        verifySerial(op, { serial: s, companyId: 'company-a', source: 'manual' }),
      ),
    ]);
    // every serial exists exactly once, created by exactly one side
    expect(await count('serials')).toBe(2 + 40);
    for (const r of manuals) expect(['new', 'duplicate']).toContain(r.result);
    const manualWins = manuals.filter((r) => r.result === 'new').length;
    expect(imp.outcome.created + manualWins).toBe(40);
    expect(imp.outcome.created + imp.outcome.skipped + imp.outcome.conflicts).toBe(40);
  });

  it('two admins importing the same file at the same time create each record exactly once', async () => {
    const buf = await makeXlsx(
      STD_HEADERS,
      Array.from({ length: 60 }, (_, i) => [`PAR-${String(i).padStart(2, '0')}`, '', 'Company A']),
    );
    const a = db('admin1');
    const b = db('admin2');
    const [pa, pb] = await Promise.all([
      previewImport(a, buf, 'p.xlsx'),
      previewImport(b, buf, 'p.xlsx'),
    ]);
    const [ra, rb] = await Promise.all([
      confirmImport(a, pa, ADMIN),
      confirmImport(b, pb, { uid: 'admin2', name: 'Bo Admin' }),
    ]);
    expect(ra.outcome.created + rb.outcome.created).toBe(60);
    expect(ra.outcome.skipped + rb.outcome.skipped).toBe(60);
    expect(await count('serials')).toBe(2 + 60);
  });
});

describe('authorization (rules)', () => {
  it('an operator cannot preview/import: reads are denied and nothing is written', async () => {
    const buf = await makeXlsx(STD_HEADERS, [['OP-1', '', 'Company A']]);
    await expect(previewImport(db('op1'), buf, 'x.xlsx')).rejects.toThrow(/permission/i);
    // even bypassing the preview: a crafted preview executed as an operator fails per record
    const fake = {
      filename: 'x',
      sheetName: 's',
      counts: { total: 1, valid: 1, new: 1, existing: 0, conflict: 0, duplicate: 0, invalid: 0 },
      rows: [
        {
          rowNumber: 2,
          serial: 'OP-1',
          partNo: '',
          companyId: 'company-a',
          companyName: 'Company A',
          cls: 'new',
          reason: '',
        },
      ],
    } as never;
    const { outcome } = await confirmImport(db('op1'), fake, { uid: 'op1', name: 'Oli Operator' });
    expect(outcome.status).toBe('failed');
    expect(await rawDoc('OP-1')).toBeUndefined();
    expect(await count('import_history')).toBe(0);
  });
});
