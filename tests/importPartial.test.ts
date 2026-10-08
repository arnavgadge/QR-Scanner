// Phase 11: a failure part-way through a large import must be reported honestly, never as success,
// and must never overwrite or half-write anything.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WRITE_CHUNK } from '../src/services/excel/importExecute';
import { confirmImport, previewImport } from '../src/services/excel/importService';
import { makeXlsx, STD_HEADERS } from './helpers';

let env: RulesTestEnvironment;
const ADMIN = { uid: 'admin1', name: 'Ada Admin' };
const adminDb = () => env.authenticatedContext('admin1').firestore() as unknown as Firestore;

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
    await setDoc(doc(d, 'users/admin1'), {
      name: ADMIN.name,
      email: 'a@x',
      role: 'admin',
      active: true,
      created_at: new Date(),
    });
    for (const [id, name] of [
      ['company-a', 'Company A'],
      ['company-b', 'Company B'],
    ]) {
      await setDoc(doc(d, 'companies', id), {
        name,
        code_type: 'barcode',
        serial_format: '',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  });
});

const ids = async () => {
  let out: string[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDocs(collection(ctx.firestore() as unknown as Firestore, 'serials'))).docs.map(
      (d) => d.id,
    );
  });
  return out;
};

describe('partial import failure', () => {
  it('a company deactivated between preview and confirm fails ONLY its chunk; the result says so and nothing is overwritten', async () => {
    // rows: chunk 1 = Company A, chunk 2 = Company B (will be deactivated), chunk 3 = Company A
    const rows: string[][] = [];
    for (let i = 0; i < WRITE_CHUNK; i++)
      rows.push([`A1-${String(i).padStart(3, '0')}`, '', 'Company A']);
    for (let i = 0; i < WRITE_CHUNK; i++)
      rows.push([`B2-${String(i).padStart(3, '0')}`, '', 'Company B']);
    for (let i = 0; i < 10; i++) rows.push([`A3-${String(i).padStart(3, '0')}`, '', 'Company A']);
    const db = adminDb();
    const preview = await previewImport(db, await makeXlsx(STD_HEADERS, rows), 'partial.xlsx');
    expect(preview.counts.new).toBe(60);

    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'companies/company-b'), { active: false });
    });

    const { outcome, historyRecorded } = await confirmImport(db, preview, ADMIN);
    expect(outcome.status).toBe('failed');
    expect(outcome.error).not.toBe('');
    expect(outcome.created).toBe(35);
    expect(outcome.notProcessed).toBe(25);
    expect(outcome.created + outcome.notProcessed).toBe(60);
    expect(historyRecorded).toBe(true);

    const stored = await ids();
    expect(stored.filter((s) => s.startsWith('A1-'))).toHaveLength(25);
    expect(stored.filter((s) => s.startsWith('A3-'))).toHaveLength(10);
    expect(stored.filter((s) => s.startsWith('B2-'))).toHaveLength(0); // that whole chunk rolled back atomically
    // the audit trail says FAILED, with the true counts
    let hist: Record<string, unknown> | undefined;
    await env.withSecurityRulesDisabled(async (ctx) => {
      hist = (
        await getDocs(collection(ctx.firestore() as unknown as Firestore, 'import_history'))
      ).docs[0]?.data();
    });
    expect(hist).toMatchObject({ status: 'failed', new: 35, filename: 'partial.xlsx' });
  });

  it('re-importing after the failure creates only the missing rows (idempotent recovery), never duplicates', async () => {
    const rows: string[][] = [];
    for (let i = 0; i < 30; i++)
      rows.push([`R-${String(i).padStart(3, '0')}`, '', i < 25 ? 'Company A' : 'Company B']);
    const db = adminDb();
    const p1 = await previewImport(db, await makeXlsx(STD_HEADERS, rows), 'r.xlsx');
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'companies/company-b'), { active: false });
    });
    const first = await confirmImport(db, p1, ADMIN);
    expect(first.outcome.status).toBe('failed');
    expect(first.outcome.created).toBe(25);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'companies/company-b'), { active: true });
    });
    const p2 = await previewImport(db, await makeXlsx(STD_HEADERS, rows), 'r.xlsx');
    expect(p2.counts).toMatchObject({ existing: 25, new: 5 });
    const second = await confirmImport(db, p2, ADMIN);
    expect(second.outcome.status).toBe('completed');
    expect(second.outcome.created).toBe(5);
    expect(await ids()).toHaveLength(30);
  });
});
