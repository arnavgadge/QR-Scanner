// Firestore Security Rules tests. Run with: npm run test:rules (needs Java + the emulator).
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-vicimus',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
after(async () => env.cleanup());

const user = (name, role, active = true) => ({
  name,
  email: `${name}@example.test`,
  role,
  active,
  created_at: new Date(),
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/admin1'), user('Ada', 'admin'));
    await setDoc(doc(db, 'users/op1'), user('Oli', 'operator'));
    await setDoc(doc(db, 'users/op2'), user('Omar', 'operator'));
    await setDoc(doc(db, 'users/off1'), user('Off', 'operator', false));
    await setDoc(doc(db, 'companies/company-a'), {
      name: 'Company A',
      code_type: 'barcode',
      serial_format: '13WAA#########',
      active: true,
    });
    await setDoc(doc(db, 'companies/old'), {
      name: 'Old',
      code_type: 'qr',
      serial_format: 'X',
      active: false,
    });
    await setDoc(doc(db, 'serials/13WAA00101A26'), {
      serial: '13WAA00101A26',
      company: 'Company A',
      company_id: 'company-a',
      source: 'manual',
      scanned_at: new Date(),
      scanned_by: 'op1',
      scanned_by_name: 'Oli',
    });
    await setDoc(doc(db, 'scan_log/log1'), {
      serial: '13WAA00101A26',
      result: 'new',
      company: 'Company A',
      company_id: 'company-a',
      source: 'manual',
      scanned_by: 'op1',
      scanned_by_name: 'Oli',
      timestamp: new Date(),
    });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('unauthenticated', () => {
  it('is denied everywhere (TEST 9)', async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, 'companies/company-a')));
    await assertFails(getDoc(doc(db, 'serials/13WAA00101A26')));
    await assertFails(getDoc(doc(db, 'scan_log/log1')));
    await assertFails(getDoc(doc(db, 'users/op1')));
  });
});

describe('account without a usable profile (TEST 10)', () => {
  it('no users document: cannot read app data', async () => {
    const db = as('ghost');
    await assertFails(getDocs(query(collection(db, 'companies'), where('active', '==', true))));
    await assertFails(getDoc(doc(db, 'scan_log/log1')));
  });
  it('inactive user: cannot read app data but can read own profile', async () => {
    const db = as('off1');
    await assertFails(getDoc(doc(db, 'companies/company-a')));
    await assertSucceeds(getDoc(doc(db, 'users/off1')));
  });
});

describe('operator', () => {
  it('reads own profile only', async () => {
    await assertSucceeds(getDoc(doc(as('op1'), 'users/op1')));
    await assertFails(getDoc(doc(as('op1'), 'users/op2')));
  });
  it('cannot promote themselves', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'users/op1'), { role: 'admin' }));
  });
  it('reads active companies, not inactive ones', async () => {
    const db = as('op1');
    await assertSucceeds(getDocs(query(collection(db, 'companies'), where('active', '==', true))));
    await assertFails(getDoc(doc(db, 'companies/old')));
  });
  it('cannot modify company configuration (TEST 6)', async () => {
    const db = as('op1');
    await assertFails(updateDoc(doc(db, 'companies/company-a'), { name: 'Hacked' }));
    await assertFails(
      setDoc(doc(db, 'companies/new'), { name: 'N', code_type: 'qr', active: true }),
    );
    await assertFails(deleteDoc(doc(db, 'companies/company-a')));
  });
  it('can get one serial but not list serials', async () => {
    const db = as('op1');
    await assertSucceeds(getDoc(doc(db, 'serials/13WAA00101A26')));
    await assertFails(getDocs(collection(db, 'serials')));
  });
  it('cannot delete a serial (TEST 7)', async () => {
    await assertFails(deleteDoc(doc(as('op1'), 'serials/13WAA00101A26')));
  });
  it('cannot modify a serial (TEST 8)', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'serials/13WAA00101A26'), { part_no: 'X' }));
  });
  it('cannot create serials directly in Phase 2', async () => {
    await assertFails(setDoc(doc(as('op1'), 'serials/NEW1'), { serial: 'NEW1' }));
  });
  it('reads scan_log', async () => {
    await assertSucceeds(getDoc(doc(as('op1'), 'scan_log/log1')));
  });
  it('can append a valid, self-attributed scan_log entry', async () => {
    await assertSucceeds(setDoc(doc(as('op1'), 'scan_log/new1'), validLog('op1', 'Oli')));
  });
  it('cannot forge another user, a wrong name or a client timestamp', async () => {
    const db = as('op1');
    await assertFails(setDoc(doc(db, 'scan_log/f1'), validLog('op2', 'Omar')));
    await assertFails(setDoc(doc(db, 'scan_log/f2'), validLog('op1', 'Someone Else')));
    await assertFails(
      setDoc(doc(db, 'scan_log/f3'), { ...validLog('op1', 'Oli'), timestamp: new Date(0) }),
    );
  });
  it('cannot tamper with or delete scan_log history', async () => {
    const db = as('op1');
    await assertFails(updateDoc(doc(db, 'scan_log/log1'), { result: 'duplicate' }));
    await assertFails(deleteDoc(doc(db, 'scan_log/log1')));
  });
});

describe('admin', () => {
  it('reads all companies, other users, and lists serials', async () => {
    const db = as('admin1');
    await assertSucceeds(getDoc(doc(db, 'companies/old')));
    await assertSucceeds(getDoc(doc(db, 'users/op1')));
    await assertSucceeds(getDocs(collection(db, 'serials')));
  });
  it('can create/update companies and update users', async () => {
    const db = as('admin1');
    await assertSucceeds(
      setDoc(doc(db, 'companies/new'), {
        name: 'N',
        code_type: 'qr',
        serial_format: 'X',
        active: true,
      }),
    );
    await assertSucceeds(updateDoc(doc(db, 'users/op1'), { active: false }));
  });
  it('still cannot edit or delete serials, or alter scan_log', async () => {
    const db = as('admin1');
    await assertFails(updateDoc(doc(db, 'serials/13WAA00101A26'), { part_no: 'X' }));
    await assertFails(deleteDoc(doc(db, 'serials/13WAA00101A26')));
    await assertFails(deleteDoc(doc(db, 'scan_log/log1')));
  });
});

function validLog(uid, name) {
  return {
    serial: 'S1',
    result: 'new',
    company: 'Company A',
    company_id: 'company-a',
    source: 'manual',
    scanned_by: uid,
    scanned_by_name: name,
    timestamp: serverTimestamp(),
  };
}
