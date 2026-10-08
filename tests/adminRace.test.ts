// Phase 10: can concurrent admin operations leave the system with zero active administrators?
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let env: RulesTestEnvironment;
const ADMINS = ['a1', 'a2', 'a3'];

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-vicimus',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => env.cleanup());

const user = (name: string, role: string, active = true) => ({
  name,
  email: `${name}@x.test`,
  role,
  active,
  created_at: new Date(),
});

async function reset(admins: string[]) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const a of admins) await setDoc(doc(db, 'users', a), user(a, 'admin'));
  });
}
const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const stamp = (uid: string, fields: Record<string, unknown>) => ({
  ...fields,
  updated_by: uid,
  updated_by_name: uid,
  updated_at: serverTimestamp(),
});
async function activeAdmins(): Promise<number> {
  let n = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const a of ADMINS) {
      const d = (await getDoc(doc(db, 'users', a))).data();
      if (d && d.role === 'admin' && d.active === true) n++;
    }
  });
  return n;
}

describe('admins cannot lock the system out of administration', () => {
  beforeEach(() => reset(['a1', 'a2']));

  it('two admins demoting / deactivating EACH OTHER at the same instant (30 rounds): >= 1 active admin remains', async () => {
    let worst = 2;
    for (let round = 0; round < 30; round++) {
      await reset(['a1', 'a2']);
      const kind = round % 2 ? { active: false } : { role: 'operator' };
      await Promise.allSettled([
        updateDoc(doc(as('a1'), 'users/a2'), stamp('a1', kind)),
        updateDoc(doc(as('a2'), 'users/a1'), stamp('a2', kind)),
      ]);
      worst = Math.min(worst, await activeAdmins());
    }
    expect(worst).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('three admins: everyone demotes a different peer at once (circular): >= 1 active admin remains', async () => {
    let worst = 3;
    for (let round = 0; round < 20; round++) {
      await reset(['a1', 'a2', 'a3']);
      await Promise.allSettled([
        updateDoc(doc(as('a1'), 'users/a2'), stamp('a1', { role: 'operator' })),
        updateDoc(doc(as('a2'), 'users/a3'), stamp('a2', { role: 'operator' })),
        updateDoc(doc(as('a3'), 'users/a1'), stamp('a3', { role: 'operator' })),
      ]);
      worst = Math.min(worst, await activeAdmins());
    }
    expect(worst).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('an admin can never change their own account, even combined with another change', async () => {
    const db = as('a1');
    await expect(
      updateDoc(doc(db, 'users/a1'), stamp('a1', { role: 'operator' })),
    ).rejects.toBeTruthy();
    await expect(
      updateDoc(doc(db, 'users/a1'), stamp('a1', { active: false })),
    ).rejects.toBeTruthy();
    expect(await activeAdmins()).toBe(2);
  });
});
