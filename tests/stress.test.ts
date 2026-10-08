// Phase 10: concurrency, retry safety and serial edge cases against the real rules (emulator).
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifySerial, type VerifyDeps } from '../src/services/serial/serialVerification';
import { AppError } from '../src/services/errors';
import type { Company } from '../src/types';

let env: RulesTestEnvironment;
const co = (id: string, name: string, serialFormat: string): Company => ({
  id,
  name,
  codeType: 'barcode',
  serialFormat,
  active: true,
  createdAt: null,
  updatedAt: null,
});
const COMPANIES = [
  co('fmt', 'Fmt Co', 'CON-######'),
  co('free', 'Free Co', ''), // legacy: any serial (barcode)
  { ...co('freeqr', 'Free QR Co', ''), codeType: 'qr' as const },
  co('zero', 'Zero Co', '000#####'),
];
const OPS = ['op1', 'op2', 'op3', 'op4', 'op5', 'op6'].map((uid, i) => ({
  uid,
  name: `Operator ${i + 1}`,
}));

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
    const db = ctx.firestore() as unknown as Firestore;
    for (const o of OPS) {
      await setDoc(doc(db, 'users', o.uid), {
        name: o.name,
        email: `${o.uid}@x.test`,
        role: 'operator',
        active: true,
        created_at: new Date(),
      });
    }
    for (const c of COMPANIES) {
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

/** One operator on one device = its own authenticated Firestore connection. */
const device = (uid: string) => {
  const op = OPS.find((o) => o.uid === uid)!;
  const db = env.authenticatedContext(uid).firestore() as unknown as Firestore;
  const deps: VerifyDeps = {
    db,
    loadActor: async () => ({ uid: op.uid, name: op.name }),
    loadCompany: async (id) => COMPANIES.find((c) => c.id === id) ?? null,
  };
  return { db, deps };
};

async function audit() {
  let serials: { id: string; data: Record<string, unknown> }[] = [];
  let logs: Record<string, unknown>[] = [];
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    serials = (await getDocs(collection(db, 'serials'))).docs.map((d) => ({
      id: d.id,
      data: d.data(),
    }));
    logs = (await getDocs(collection(db, 'scan_log'))).docs.map((d) => d.data());
  });
  return { serials, logs };
}

async function rules<T>(fn: (db: Firestore) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await env.withSecurityRulesDisabled(async (ctx) => {
    out = await fn(ctx.firestore() as unknown as Firestore);
  });
  return out as T;
}

const submit = (
  d: ReturnType<typeof device>,
  serial: string,
  source: 'manual' | 'scan' = 'manual',
  companyId = 'fmt',
) => verifySerial(d.deps, { serial, companyId, source });

describe('N-way simultaneous registration of one serial', () => {
  for (const [n, rounds] of [
    [3, 30],
    [4, 30],
    [6, 20],
  ] as const) {
    it(`${n} operators x ${rounds} rounds: exactly 1 NEW and ${n - 1} DUPLICATE per serial`, async () => {
      const devices = OPS.slice(0, n).map((o) => device(o.uid));
      for (let r = 0; r < rounds; r++) {
        const serial = `CON-${String(r).padStart(6, '0')}`;
        const res = await Promise.all(devices.map((d) => submit(d, serial)));
        const kinds = res.map((x) => x.result);
        expect(
          kinds.filter((k) => k === 'new'),
          `round ${r}: ${kinds}`,
        ).toHaveLength(1);
        expect(
          kinds.filter((k) => k === 'duplicate'),
          `round ${r}: ${kinds}`,
        ).toHaveLength(n - 1);
      }
      const a = await audit();
      expect(a.serials).toHaveLength(rounds);
      expect(a.logs).toHaveLength(rounds * n);
      expect(a.logs.filter((l) => l.result === 'new')).toHaveLength(rounds);
      // every 'new' log has exactly one matching serial doc registered by the same operator
      for (const l of a.logs.filter((x) => x.result === 'new')) {
        const s = a.serials.find((x) => x.id === l.serial)!;
        expect(s.data.scanned_by).toBe(l.scanned_by);
      }
    }, 120_000);
  }

  it('mixed manual + photo(scan) sources racing: still exactly one NEW', async () => {
    const devices = OPS.slice(0, 4).map((o) => device(o.uid));
    for (let r = 0; r < 10; r++) {
      const serial = `CON-${String(900000 + r)}`;
      const res = await Promise.all(
        devices.map((d, i) => submit(d, serial, i % 2 ? 'scan' : 'manual')),
      );
      expect(res.filter((x) => x.result === 'new')).toHaveLength(1);
    }
  }, 60_000);

  it('the SAME operator double-submitting on ONE connection (no UI guard): one NEW, rest DUPLICATE', async () => {
    const d = device('op1');
    const res = await Promise.all(Array.from({ length: 6 }, () => submit(d, 'CON-123456')));
    expect(res.filter((x) => x.result === 'new')).toHaveLength(1);
    expect(res.filter((x) => x.result === 'duplicate')).toHaveLength(5);
    const a = await audit();
    expect(a.serials).toHaveLength(1);
    expect(a.logs).toHaveLength(6);
  });

  it("losers see the WINNER's record (first writer metadata is never altered)", async () => {
    const devices = OPS.slice(0, 4).map((o) => device(o.uid));
    const res = await Promise.all(devices.map((d) => submit(d, 'CON-777777')));
    const winner = res.findIndex((x) => x.result === 'new');
    const a = await audit();
    expect(a.serials[0]?.data.scanned_by).toBe(OPS[winner]!.uid);
    for (const x of res) {
      if (x.result === 'duplicate') expect(x.existingRecord.scannedBy).toBe(OPS[winner]!.uid);
    }
  });
});

describe('retry safety', () => {
  it('a retry after a (possibly lost) success is a DUPLICATE, never a second NEW', async () => {
    const d = device('op1');
    const first = await submit(d, 'CON-000042');
    expect(first.result).toBe('new');
    // The client "did not see" the response and the operator retries:
    const retry = await submit(d, 'CON-000042');
    expect(retry.result).toBe('duplicate');
    const a = await audit();
    expect(a.serials).toHaveLength(1);
    expect(a.logs.map((l) => l.result).sort()).toEqual(['duplicate', 'new']);
  });

  it('a failed attempt (denied) writes nothing; the retry afterwards registers exactly once', async () => {
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    const bad = await submit({ db: anon, deps: { ...device('op1').deps, db: anon } }, 'CON-000043');
    expect(bad.result).toBe('error');
    expect((await audit()).serials).toHaveLength(0);
    expect((await audit()).logs).toHaveLength(0);
    expect((await submit(device('op1'), 'CON-000043')).result).toBe('new');
    expect((await audit()).serials).toHaveLength(1);
  });

  it('5 repeated submissions of an existing serial: 1 original, 5 duplicate logs, metadata unchanged', async () => {
    const d = device('op1');
    await submit(d, 'CON-000044');
    const before = (await audit()).serials[0]!.data;
    for (let i = 0; i < 5; i++) {
      const r = await submit(device('op2'), 'CON-000044');
      expect(r.result).toBe('duplicate');
    }
    const a = await audit();
    expect(a.serials).toHaveLength(1);
    expect(a.serials[0]!.data).toEqual(before);
    expect(a.logs.filter((l) => l.result === 'duplicate')).toHaveLength(5);
    expect(a.logs.filter((l) => l.result === 'new')).toHaveLength(1);
  });
});

describe('serial values (validation + exact storage)', () => {
  const d = () => device('op1');
  it('leading zeros are stored and returned exactly', async () => {
    const r = await submit(d(), '00012345', 'manual', 'zero');
    expect(r.result).toBe('new');
    const a = await audit();
    expect(a.serials[0]!.id).toBe('00012345');
    expect(a.serials[0]!.data.serial).toBe('00012345');
  });
  it('hyphen / underscore / mixed case are preserved (case is normalized to upper)', async () => {
    for (const [input, stored] of [
      ['ab-cd_12-x', 'AB-CD_12-X'],
      ['  Mixed-Case_9  ', 'MIXED-CASE_9'],
    ] as const) {
      const r = await submit(d(), input, 'manual', 'free');
      expect(r.result).toBe('new');
      const s = await rules(async (db) => (await getDoc(doc(db, 'serials', stored))).exists());
      expect(s).toBe(true);
    }
  });
  it('invalid values never write: empty, whitespace, short, long, wrong prefix, wrong chars', async () => {
    for (const bad of [
      '',
      '   ',
      'CON-12',
      'CON-1234567',
      'XXX-123456',
      'CON-12A456',
      'CON 123456',
      'con-12345!',
    ]) {
      const r = await submit(d(), bad);
      expect(r.result, `"${bad}"`).toBe('invalid');
    }
    const a = await audit();
    expect(a.serials).toHaveLength(0);
    expect(a.logs).toHaveLength(0);
  });
  it('document-id unsafe values on a free-format company are rejected with a clear message, nothing written', async () => {
    for (const bad of ['A/B', '.', '..', '__reserved__']) {
      const r = await submit(d(), bad, 'manual', 'free');
      expect(r.result, `"${bad}"`).toBe('invalid');
      if (r.result === 'invalid') expect(r.message).toMatch(/not allowed/);
    }
    expect((await audit()).serials).toHaveLength(0);
    expect((await audit()).logs).toHaveLength(0);
  });
  it('a serial over 100 characters (the rules limit) is rejected clearly; exactly 100 is stored exactly', async () => {
    const tooLong = await submit(d(), 'L'.repeat(101), 'manual', 'free');
    expect(tooLong.result).toBe('invalid');
    if (tooLong.result === 'invalid') expect(tooLong.message).toMatch(/longer than 100/);
    expect((await audit()).serials).toHaveLength(0);
    expect((await audit()).logs).toHaveLength(0);
    // 'free' is a BARCODE company (80-char label limit); a QR company carries all 100.
    const ok = 'K'.repeat(100);
    expect((await submit(d(), ok, 'manual', 'freeqr')).result).toBe('new');
    const a = await audit();
    expect(a.serials[0]!.id).toBe(ok);
    expect(a.serials[0]!.data.serial).toBe(ok);
  });
  it('a serial the barcode label cannot encode (81+ chars, non-ASCII) is refused BEFORE registering; QR accepts non-ASCII', async () => {
    for (const bad of ['B'.repeat(81), 'ÉCOLE-42', 'abé']) {
      const r = await submit(d(), bad, 'manual', 'free');
      expect(r.result, bad).toBe('invalid');
      if (r.result === 'invalid') expect(r.message).toMatch(/barcode label/i);
    }
    expect((await audit()).serials).toHaveLength(0);
    expect((await audit()).logs).toHaveLength(0);
    expect((await submit(d(), 'B'.repeat(80), 'manual', 'free')).result).toBe('new');
    expect((await submit(d(), 'ÉCOLE-42', 'manual', 'freeqr')).result).toBe('new');
  });
  it('lookups by exact ID: 12345 and 00012345 are different serials', async () => {
    await submit(d(), '00012345', 'manual', 'free');
    const r = await submit(d(), '12345', 'manual', 'free');
    expect(r.result).toBe('new');
    expect((await audit()).serials).toHaveLength(2);
  });
  it('queries by serial field find exactly the registered attempts', async () => {
    await submit(d(), 'CON-555555');
    await submit(device('op2'), 'CON-555555');
    const n = await rules(
      async (db) =>
        (await getDocs(query(collection(db, 'scan_log'), where('serial', '==', 'CON-555555'))))
          .size,
    );
    expect(n).toBe(2);
  });
});

describe('company deactivated while the operator is working', () => {
  it('permission-denied on the company read (rules hide inactive companies) is reported as "unavailable", nothing written', async () => {
    const dev = device('op1');
    const deps: VerifyDeps = {
      ...dev.deps,
      loadCompany: async () => {
        throw new AppError('permission-denied', 'denied');
      },
    };
    const r = await verifySerial(deps, {
      serial: 'CON-000001',
      companyId: 'fmt',
      source: 'manual',
    });
    expect(r.result).toBe('error');
    if (r.result === 'error') {
      expect(r.code).toBe('company-unavailable');
      expect(r.message).toMatch(/unavailable/i);
    }
    const a = await audit();
    expect(a.serials).toHaveLength(0);
    expect(a.logs).toHaveLength(0);
  });
  it('a genuine permission problem on the WRITE is still reported as a permission error', async () => {
    const anon = env.unauthenticatedContext().firestore() as unknown as Firestore;
    const dev = device('op1');
    const r = await verifySerial(
      { ...dev.deps, db: anon },
      { serial: 'CON-000002', companyId: 'fmt', source: 'manual' },
    );
    expect(r.result).toBe('error');
  });
});
