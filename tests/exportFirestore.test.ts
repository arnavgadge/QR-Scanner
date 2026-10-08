// Emulator-backed: export reads (paging, completeness, access control) against the real rules.
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, Timestamp, writeBatch } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchAllCompanies, fetchAllSerials } from '../src/services/excel/exportData';

let env: RulesTestEnvironment;
const db = (uid?: string) =>
  (uid
    ? env.authenticatedContext(uid)
    : env.unauthenticatedContext()
  ).firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-vicimus',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => env.cleanup());

const TOTAL = 137; // not a multiple of the test page size, spans several pages
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'users/admin1'), {
      name: 'Ada',
      email: 'a@x',
      role: 'admin',
      active: true,
      created_at: new Date(),
    });
    await setDoc(doc(d, 'users/op1'), {
      name: 'Oli',
      email: 'o@x',
      role: 'operator',
      active: true,
      created_at: new Date(),
    });
    await setDoc(doc(d, 'companies/company-a'), {
      name: 'Company A',
      code_type: 'barcode',
      serial_format: '',
      active: true,
    });
    await setDoc(doc(d, 'companies/old'), {
      name: 'Old Co',
      code_type: 'qr',
      serial_format: '',
      active: false,
    });
    let batch = writeBatch(d);
    for (let i = 0; i < TOTAL; i++) {
      const serial = String(i).padStart(8, '0'); // leading zeros
      batch.set(doc(d, 'serials', serial), {
        serial,
        part_no: '',
        company: 'Company A',
        company_id: 'company-a',
        source: i % 2 ? 'excel' : 'manual',
        scanned_at: Timestamp.fromDate(new Date(2026, 0, 1, 0, 0, i)),
        scanned_by: 'op1',
        scanned_by_name: 'Oli',
      });
      if ((i + 1) % 400 === 0) {
        await batch.commit();
        batch = writeBatch(d);
      }
    }
    await batch.commit();
    // A recent-scans style log must NOT influence the export (it is not read at all).
    await setDoc(doc(d, 'scan_log/l1'), { serial: '00000001', result: 'new' });
  });
});

describe('export reads', () => {
  it('admin reads EVERY serial exactly once across pages, text IDs intact', async () => {
    const progress: number[] = [];
    const all = await fetchAllSerials(db('admin1'), (n) => progress.push(n), 25);
    expect(all).toHaveLength(TOTAL);
    expect(new Set(all.map((s) => s.serial)).size).toBe(TOTAL); // no duplicates
    expect(all.map((s) => s.serial).sort()[0]).toBe('00000000'); // leading zeros preserved
    expect(progress.at(-1)).toBe(TOTAL);
    expect(progress.length).toBe(Math.ceil(TOTAL / 25));
    expect(all.every((s) => !s.incomplete && s.scannedAt instanceof Date)).toBe(true);
    expect(all.filter((s) => s.source === 'excel')).toHaveLength(Math.floor(TOTAL / 2));
  });

  it('page size exactly equal to the dataset size still terminates correctly', async () => {
    expect(await fetchAllSerials(db('admin1'), undefined, TOTAL)).toHaveLength(TOTAL);
  });

  it('admin reads all companies including inactive', async () => {
    const companies = await fetchAllCompanies(db('admin1'));
    expect(companies.map((c) => c.id).sort()).toEqual(['company-a', 'old']);
  });

  it('flags incomplete documents instead of failing the export', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'serials/ODD-1'), { company_id: 'company-a' });
    });
    const all = await fetchAllSerials(db('admin1'), undefined, 50);
    const odd = all.find((s) => s.serial === 'ODD-1')!;
    expect(odd.incomplete).toBe(true);
    expect(all).toHaveLength(TOTAL + 1);
  });

  it('operator cannot read the full serial dataset (list denied)', async () => {
    await assertFails(fetchAllSerials(db('op1')));
    await assertFails(getDocs(collection(db('op1'), 'serials')));
  });

  it('unauthenticated cannot read the serial dataset', async () => {
    await assertFails(fetchAllSerials(db()));
  });

  it('admin list is permitted by the rules', async () => {
    await assertSucceeds(getDocs(collection(db('admin1'), 'serials')));
  });
});
