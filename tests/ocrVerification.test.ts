// Emulator-backed: a confirmed OCR reading uses the SAME verification as manual entry (source "scan").
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifySerial, type VerifyDeps } from '../src/services/serial/serialVerification';
import type { Company } from '../src/types';

let env: RulesTestEnvironment;
const CO: Company = {
  id: 'company-a',
  name: 'Company A',
  codeType: 'barcode',
  serialFormat: '13WAA#########',
  active: true,
  createdAt: null,
  updatedAt: null,
};

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
    for (const [uid, name] of [
      ['op1', 'Oli'],
      ['op2', 'Omar'],
    ]) {
      await setDoc(doc(d, 'users', uid!), {
        name,
        email: `${uid}@x`,
        role: 'operator',
        active: true,
        created_at: new Date(),
      });
    }
    await setDoc(doc(d, 'companies/company-a'), {
      name: 'Company A',
      code_type: 'barcode',
      serial_format: '13WAA#########',
      active: true,
    });
  });
});

const client = (uid: string, name: string): VerifyDeps => ({
  db: env.authenticatedContext(uid).firestore() as unknown as Firestore,
  loadActor: async () => ({ uid, name }),
  loadCompany: async () => CO,
});
const state = async (serial: string) => {
  let out = { doc: null as Record<string, unknown> | null, logs: [] as Record<string, unknown>[] };
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const d = await getDoc(doc(db, 'serials', serial));
    const logs = await getDocs(query(collection(db, 'scan_log'), where('serial', '==', serial)));
    out = { doc: d.exists() ? d.data() : null, logs: logs.docs.map((x) => x.data()) };
  });
  return out;
};

describe('OCR → confirmed serial → shared verification (source "scan")', () => {
  it('TEST 1/6: a confirmed OCR serial registers as NEW with source "scan" (doc and log)', async () => {
    const r = await verifySerial(client('op1', 'Oli'), {
      serial: '13WAA000000401',
      companyId: 'company-a',
      source: 'scan',
    });
    expect(r.result).toBe('new');
    if (r.result === 'new') expect(r.source).toBe('scan');
    const s = await state('13WAA000000401');
    expect(s.doc).toMatchObject({ source: 'scan', scanned_by: 'op1', company_id: 'company-a' });
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatchObject({ result: 'new', source: 'scan' });
  });

  it('TEST 2: the user-corrected value (ABC123-style typo fixed) is what gets verified', async () => {
    // OCR read "13WAA00000040I" (I for 1); the operator corrects it to ...401 before confirming.
    const confirmed = '13WAA000000401';
    const r = await verifySerial(client('op1', 'Oli'), {
      serial: confirmed,
      companyId: 'company-a',
      source: 'scan',
    });
    expect(r.result).toBe('new');
    expect((await state('13WAA00000040I')).doc).toBeNull(); // the OCR typo was never registered
    expect((await state(confirmed)).doc).not.toBeNull();
  });

  it('format validation is identical for OCR and manual: an OCR typo is rejected, nothing written', async () => {
    const ocr = await verifySerial(client('op1', 'Oli'), {
      serial: '13WAA00000040I',
      companyId: 'company-a',
      source: 'scan',
    });
    const manual = await verifySerial(client('op1', 'Oli'), {
      serial: '13WAA00000040I',
      companyId: 'company-a',
      source: 'manual',
    });
    expect(ocr).toMatchObject({ result: 'invalid', reason: 'format' });
    expect(ocr).toEqual(manual);
    expect((await state('13WAA00000040I')).doc).toBeNull();
    expect((await state('13WAA00000040I')).logs).toHaveLength(0);
  });

  it('TEST 5: an OCR serial that already exists gives the same DUPLICATE as manual; record untouched', async () => {
    const first = await verifySerial(client('op1', 'Oli'), {
      serial: '13WAA000000500',
      companyId: 'company-a',
      source: 'manual',
    });
    expect(first.result).toBe('new');
    const before = (await state('13WAA000000500')).doc;
    const r = await verifySerial(client('op2', 'Omar'), {
      serial: '13WAA000000500',
      companyId: 'company-a',
      source: 'scan',
    });
    expect(r.result).toBe('duplicate');
    if (r.result === 'duplicate') {
      expect(r.existingRecord.scannedByName).toBe('Oli');
      expect(r.existingRecord.source).toBe('manual');
    }
    const s = await state('13WAA000000500');
    expect(s.doc).toEqual(before); // original (source manual) preserved
    expect(s.logs.map((l) => [l.result, l.source]).sort()).toEqual([
      ['duplicate', 'scan'],
      ['new', 'manual'],
    ]);
  });

  it('atomicity is preserved: manual and OCR racing for one serial => exactly one NEW', async () => {
    for (let i = 0; i < 10; i++) {
      const serial = `13WAA0000007${String(i).padStart(2, '0')}`;
      const [a, b] = await Promise.all([
        verifySerial(client('op1', 'Oli'), { serial, companyId: 'company-a', source: 'manual' }),
        verifySerial(client('op2', 'Omar'), { serial, companyId: 'company-a', source: 'scan' }),
      ]);
      expect([a.result, b.result].sort()).toEqual(['duplicate', 'new']);
      const s = await state(serial);
      expect(s.logs).toHaveLength(2);
      expect(s.doc?.source).toBe(a.result === 'new' ? 'manual' : 'scan');
    }
  });

  it('rules: unauthenticated users cannot register a scan-source serial; scan source stays staff-only', async () => {
    const anon: VerifyDeps = {
      ...client('op1', 'Oli'),
      db: env.unauthenticatedContext().firestore() as unknown as Firestore,
    };
    const r = await verifySerial(anon, {
      serial: '13WAA000000900',
      companyId: 'company-a',
      source: 'scan',
    });
    expect(r.result).toBe('error');
    expect((await state('13WAA000000900')).doc).toBeNull();
  });
});
