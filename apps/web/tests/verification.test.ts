// Emulator-backed tests of the Phase 3 verification service.
// Run with: npm test   (starts the Firestore emulator; needs Java 21+)
// Each "client" is a separate authenticated Firestore instance with the REAL security rules.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifySerial, type VerifyDeps } from '../src/services/serial/serialVerification';
import type { Company } from '../src/types';

let env: RulesTestEnvironment;

const company = (id: string, name: string, serialFormat: string): Company => ({
  id,
  name,
  codeType: 'barcode',
  serialFormat,
  active: true,
  createdAt: null,
  updatedAt: null,
});
const TEST_CO = company('test-co', 'Test Co', 'SERIAL-###');
const CONC_CO = company('conc-co', 'Concurrency Co', 'CONCURRENT-TEST-###');

const OPERATORS = [
  { uid: 'op1', name: 'Oli' },
  { uid: 'op2', name: 'Omar' },
  { uid: 'op3', name: 'Ola' },
  { uid: 'op4', name: 'Otto' },
];

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
    const db = ctx.firestore();
    const { setDoc } = await import('firebase/firestore');
    for (const o of OPERATORS) {
      await setDoc(doc(db, 'users', o.uid), {
        name: o.name,
        email: `${o.uid}@x.test`,
        role: 'operator',
        active: true,
        created_at: new Date(),
      });
    }
    for (const c of [TEST_CO, CONC_CO]) {
      await setDoc(doc(db, 'companies', c.id), {
        name: c.name,
        code_type: c.codeType,
        serial_format: c.serialFormat,
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  });
});

/** A client = one operator on one "device", with its own Firestore connection. */
function client(uid: string, opts: { counter?: { reads: number } } = {}) {
  const op = OPERATORS.find((o) => o.uid === uid)!;
  const db = env.authenticatedContext(uid).firestore() as unknown as Firestore;
  const deps: VerifyDeps = {
    db,
    loadActor: async () => ({ uid: op.uid, name: op.name }),
    loadCompany: async (id) => {
      if (opts.counter) opts.counter.reads++;
      return [TEST_CO, CONC_CO].find((c) => c.id === id) ?? null;
    },
  };
  return { db, deps, op };
}

async function counts(serial: string) {
  let docs = 0,
    logs = 0,
    results: string[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    docs = (await getDoc(doc(db, 'serials', serial))).exists() ? 1 : 0;
    const snap = await getDocs(query(collection(db, 'scan_log'), where('serial', '==', serial)));
    logs = snap.size;
    results = snap.docs.map((d) => d.data().result as string).sort();
  });
  return { docs, logs, results };
}

describe('verifySerial', () => {
  it('Test 1 — new serial: validates, creates serial + log, result=new', async () => {
    const c = client('op1');
    const r = await verifySerial(c.deps, {
      serial: 'SERIAL-001',
      companyId: 'test-co',
      source: 'manual',
    });
    expect(r.result).toBe('new');
    expect(await counts('SERIAL-001')).toEqual({ docs: 1, logs: 1, results: ['new'] });

    const stored = (await getDoc(doc(c.db, 'serials', 'SERIAL-001'))).data()!;
    expect(stored).toMatchObject({
      serial: 'SERIAL-001',
      company: 'Test Co',
      company_id: 'test-co',
      source: 'manual',
      scanned_by: 'op1',
      scanned_by_name: 'Oli',
      part_no: '',
    });
    // authoritative server timestamp, not a client Date
    expect(typeof stored.scanned_at.toDate).toBe('function');
    if (r.result === 'new') {
      expect(r.scannedByName).toBe('Oli');
      expect(Date.parse(r.scannedAt)).toBeCloseTo(stored.scanned_at.toDate().getTime(), -2);
    }
  });

  it('Test 2 — same serial again: duplicate, log created, original untouched', async () => {
    const first = client('op1');
    const second = client('op2');
    await verifySerial(first.deps, {
      serial: 'SERIAL-001',
      companyId: 'test-co',
      source: 'manual',
    });
    const before = (await getDoc(doc(first.db, 'serials', 'SERIAL-001'))).data()!;

    const r = await verifySerial(second.deps, {
      serial: ' serial-001 ',
      companyId: 'test-co',
      source: 'manual',
    });
    expect(r.result).toBe('duplicate');
    if (r.result === 'duplicate') {
      expect(r.existingRecord.scannedByName).toBe('Oli'); // PREVIOUS
      expect(r.existingRecord.scannedBy).toBe('op1');
      expect(r.currentAttempt.scannedByName).toBe('Omar'); // CURRENT
      expect(r.currentAttempt.scannedBy).toBe('op2');
    }
    const after = (await getDoc(doc(first.db, 'serials', 'SERIAL-001'))).data()!;
    expect(after).toEqual(before); // original registration unchanged
    expect(await counts('SERIAL-001')).toEqual({ docs: 1, logs: 2, results: ['duplicate', 'new'] });
  });

  it('Test 3 — invalid format: nothing written', async () => {
    const c = client('op1');
    const r = await verifySerial(c.deps, {
      serial: 'BAD-1',
      companyId: 'test-co',
      source: 'manual',
    });
    expect(r).toMatchObject({ result: 'invalid', reason: 'format' });
    if (r.result === 'invalid') expect(r.message).toContain('Invalid serial format for Test Co');
    expect(await counts('BAD-1')).toEqual({ docs: 0, logs: 0, results: [] });
  });

  it('Test 4 — empty serial: local validation, no Firestore/company/actor access', async () => {
    const counter = { reads: 0 };
    let actorCalls = 0;
    const c = client('op1', { counter });
    c.deps.loadActor = async () => {
      actorCalls++;
      return null;
    };
    for (const blank of ['', '   ', '\t\n']) {
      const r = await verifySerial(c.deps, {
        serial: blank,
        companyId: 'test-co',
        source: 'manual',
      });
      expect(r).toMatchObject({ result: 'invalid', reason: 'empty' });
    }
    expect(counter.reads).toBe(0);
    expect(actorCalls).toBe(0);
  });

  it('requires a company and an authenticated actor', async () => {
    const c = client('op1');
    expect(
      await verifySerial(c.deps, { serial: 'SERIAL-005', companyId: '', source: 'manual' }),
    ).toMatchObject({ result: 'invalid', reason: 'no-company' });
    c.deps.loadActor = async () => null;
    expect(
      await verifySerial(c.deps, { serial: 'SERIAL-005', companyId: 'test-co', source: 'manual' }),
    ).toMatchObject({ result: 'error', code: 'unauthenticated' });
    expect(await counts('SERIAL-005')).toEqual({ docs: 0, logs: 0, results: [] });
  });

  it('a database failure is an error, never reported as new', async () => {
    const c = client('op1');
    // An unauthenticated Firestore is denied by the rules => transaction fails.
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    const r = await verifySerial(
      { ...c.deps, db: anon },
      { serial: 'SERIAL-006', companyId: 'test-co', source: 'manual' },
    );
    expect(r.result).toBe('error');
    expect(await counts('SERIAL-006')).toEqual({ docs: 0, logs: 0, results: [] });
  });

  it('the same serial is a duplicate across companies (global uniqueness)', async () => {
    const c = client('op1');
    await verifySerial(c.deps, { serial: 'SERIAL-002', companyId: 'test-co', source: 'manual' });
    const r = await verifySerial(c.deps, {
      serial: 'SERIAL-002',
      companyId: 'test-co',
      source: 'manual',
    });
    expect(r.result).toBe('duplicate');
  });
});

describe('concurrency', () => {
  it('Test 5 — two simultaneous requests for one serial: exactly one NEW, one DUPLICATE', async () => {
    const a = client('op1');
    const b = client('op2');
    const input = {
      serial: 'CONCURRENT-TEST-001',
      companyId: 'conc-co',
      source: 'manual' as const,
    };
    const [ra, rb] = await Promise.all([verifySerial(a.deps, input), verifySerial(b.deps, input)]);
    expect([ra.result, rb.result].sort()).toEqual(['duplicate', 'new']);
    expect(await counts('CONCURRENT-TEST-001')).toEqual({
      docs: 1,
      logs: 2,
      results: ['duplicate', 'new'],
    });
  });

  it('stress — 4 devices x 25 serials, all racing: every serial registered exactly once', async () => {
    const clients = OPERATORS.map((o) => client(o.uid));
    for (let round = 0; round < 25; round++) {
      const serial = `CONCURRENT-TEST-${String(round).padStart(3, '0')}`;
      const results = await Promise.all(
        clients.map((c) =>
          verifySerial(c.deps, { serial, companyId: 'conc-co', source: 'manual' }),
        ),
      );
      const kinds = results.map((r) => r.result);
      expect(kinds.filter((k) => k === 'new')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'duplicate')).toHaveLength(3);
    }
    // 25 serial docs, 100 logs, exactly 25 'new'
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      expect((await getDocs(collection(db, 'serials'))).size).toBe(25);
      const logs = await getDocs(collection(db, 'scan_log'));
      expect(logs.size).toBe(100);
      expect(logs.docs.filter((d) => d.data().result === 'new')).toHaveLength(25);
    });
  });
});
