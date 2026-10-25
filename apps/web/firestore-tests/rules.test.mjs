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
  writeBatch,
  orderBy,
  limit,
  documentId,
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
  it('can register a NEW serial: serial + matching log in one commit', async () => {
    const db = as('op1');
    const b = writeBatch(db);
    b.set(doc(db, 'serials/13WAA000000001'), validSerial('op1', 'Oli'));
    b.set(doc(db, 'scan_log/n1'), validLog('op1', 'Oli', '13WAA000000001', 'new'));
    await assertSucceeds(b.commit());
  });
  it('can log a DUPLICATE attempt for an existing serial (and nothing else)', async () => {
    const db = as('op2');
    await assertSucceeds(
      setDoc(doc(db, 'scan_log/d1'), validLog('op2', 'Omar', '13WAA00101A26', 'duplicate')),
    );
  });
  it('cannot register a serial for another user, wrong name, client time or extra fields', async () => {
    const db = as('op1');
    const ref = doc(db, 'serials/13WAA000000002');
    await assertFails(setDoc(ref, validSerial('op2', 'Omar')));
    await assertFails(setDoc(ref, validSerial('op1', 'Someone Else')));
    await assertFails(setDoc(ref, { ...validSerial('op1', 'Oli'), scanned_at: new Date(0) }));
    await assertFails(setDoc(ref, { ...validSerial('op1', 'Oli'), extra: 1 }));
    await assertFails(setDoc(ref, { ...validSerial('op1', 'Oli'), serial: 'OTHER' }));
    await assertFails(setDoc(ref, { ...validSerial('op1', 'Oli'), source: 'excel' }));
  });
  it('cannot register against an inactive, unknown or mismatched company', async () => {
    const db = as('op1');
    const ref = doc(db, 'serials/13WAA000000003');
    await assertFails(
      setDoc(ref, { ...validSerial('op1', 'Oli'), company_id: 'old', company: 'Old' }),
    );
    await assertFails(setDoc(ref, { ...validSerial('op1', 'Oli'), company_id: 'nope' }));
    await assertFails(setDoc(ref, { ...validSerial('op1', 'Oli'), company: 'Company B' }));
  });
  it('cannot overwrite an existing serial via create-style set', async () => {
    const db = as('op1');
    await assertFails(
      setDoc(doc(db, 'serials/13WAA00101A26'), validSerial('op1', 'Oli', '13WAA00101A26')),
    );
  });
  it('cannot forge a log: NEW without the serial, DUPLICATE for a missing serial', async () => {
    const db = as('op1');
    await assertFails(setDoc(doc(db, 'scan_log/x1'), validLog('op1', 'Oli', 'NOPE-1', 'new')));
    await assertFails(
      setDoc(doc(db, 'scan_log/x2'), validLog('op1', 'Oli', 'NOPE-2', 'duplicate')),
    );
    // 'new' for a serial that already exists (even in a batch that tries to re-set it)
    await assertFails(
      setDoc(doc(db, 'scan_log/x3'), validLog('op1', 'Oli', '13WAA00101A26', 'new')),
    );
  });
  it('reads scan_log', async () => {
    await assertSucceeds(getDoc(doc(as('op1'), 'scan_log/log1')));
  });
  it('cannot forge another user, a wrong name or a client timestamp in a log', async () => {
    const db = as('op1');
    const dup = (uid, name) => validLog(uid, name, '13WAA00101A26', 'duplicate');
    await assertFails(setDoc(doc(db, 'scan_log/f1'), dup('op2', 'Omar')));
    await assertFails(setDoc(doc(db, 'scan_log/f2'), dup('op1', 'Someone Else')));
    await assertFails(
      setDoc(doc(db, 'scan_log/f3'), { ...dup('op1', 'Oli'), timestamp: new Date(0) }),
    );
  });
  it('unauthenticated cannot register or log', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'serials/13WAA000000009'), validSerial('op1', 'Oli')));
    await assertFails(
      setDoc(doc(db, 'scan_log/u1'), validLog('op1', 'Oli', '13WAA00101A26', 'duplicate')),
    );
  });
  it('inactive and profile-less users cannot register', async () => {
    for (const [uid, name] of [
      ['off1', 'Off'],
      ['ghost', 'Ghost'],
    ]) {
      const db = as(uid);
      await assertFails(setDoc(doc(db, 'serials/13WAA000000008'), validSerial(uid, name)));
    }
  });
  it('cannot tamper with or delete scan_log history', async () => {
    const db = as('op1');
    await assertFails(updateDoc(doc(db, 'scan_log/log1'), { result: 'duplicate' }));
    await assertFails(deleteDoc(doc(db, 'scan_log/log1')));
  });
});

describe('company code type (label output) is admin-only configuration', () => {
  it('an admin can set barcode or qr; an unsupported value is rejected', async () => {
    const db = as('admin1');
    await assertSucceeds(
      updateDoc(doc(db, 'companies/company-a'), adminStamp({ code_type: 'qr' })),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'companies/company-a'), adminStamp({ code_type: 'barcode' })),
    );
    await assertFails(
      updateDoc(doc(db, 'companies/company-a'), adminStamp({ code_type: 'hologram' })),
    );
    await assertFails(updateDoc(doc(db, 'companies/company-a'), adminStamp({ code_type: null })));
    // an unattributed edit is rejected
    await assertFails(updateDoc(doc(db, 'companies/company-a'), { code_type: 'qr' }));
  });
  it('operators (and signed-out / inactive users) cannot change it', async () => {
    for (const db of [as('op1'), anon(), as('off1'), as('ghost')]) {
      await assertFails(updateDoc(doc(db, 'companies/company-a'), { code_type: 'qr' }));
    }
  });
});

describe('photo/OCR registrations use the same rules as manual (source "scan")', () => {
  const scanSerial = (uid, name, serial) => ({ ...validSerial(uid, name), serial, source: 'scan' });
  it('an operator can register a scan-source serial with a matching scan log, in one commit', async () => {
    const db = as('op1');
    const b = writeBatch(db);
    b.set(doc(db, 'serials/13WAA000000601'), scanSerial('op1', 'Oli', '13WAA000000601'));
    b.set(doc(db, 'scan_log/s1'), {
      ...validLog('op1', 'Oli', '13WAA000000601', 'new'),
      source: 'scan',
    });
    await assertSucceeds(b.commit());
  });
  it('unauthenticated, inactive and profile-less users cannot register a scan-source serial', async () => {
    await assertFails(
      setDoc(doc(anon(), 'serials/13WAA000000602'), scanSerial('op1', 'Oli', '13WAA000000602')),
    );
    await assertFails(
      setDoc(
        doc(as('off1'), 'serials/13WAA000000603'),
        scanSerial('off1', 'Off', '13WAA000000603'),
      ),
    );
    await assertFails(
      setDoc(
        doc(as('ghost'), 'serials/13WAA000000604'),
        scanSerial('ghost', 'G', '13WAA000000604'),
      ),
    );
  });
  it('OCR cannot be used to overwrite an existing serial or to forge another operator', async () => {
    await assertFails(
      setDoc(doc(as('op1'), 'serials/13WAA00101A26'), scanSerial('op1', 'Oli', '13WAA00101A26')),
    );
    await assertFails(
      setDoc(doc(as('op1'), 'serials/13WAA000000605'), scanSerial('op2', 'Omar', '13WAA000000605')),
    );
  });
});

describe('excel import: serials + import_history', () => {
  const excelSerial = (uid, name, extra = {}) => ({
    ...validSerial(uid, name, undefined),
    serial: 'IMP-1',
    source: 'excel',
    ...extra,
  });
  const history = (uid, name, extra = {}) => ({
    filename: 'a.xlsx',
    imported_by: uid,
    imported_by_name: name,
    imported_at: serverTimestamp(),
    total_rows: 10,
    new: 5,
    skipped: 3,
    conflicts: 1,
    duplicates: 1,
    invalid: 0,
    status: 'completed',
    ...extra,
  });

  it('admin can create an excel-source serial (create-only), operator cannot', async () => {
    await assertSucceeds(setDoc(doc(as('admin1'), 'serials/IMP-1'), excelSerial('admin1', 'Ada')));
    await assertFails(
      setDoc(doc(as('op1'), 'serials/IMP-2'), excelSerial('op1', 'Oli', { serial: 'IMP-2' })),
    );
    await assertFails(
      setDoc(doc(as('ghost'), 'serials/IMP-3'), excelSerial('ghost', 'G', { serial: 'IMP-3' })),
    );
  });
  it('an import can never overwrite or edit an existing serial, even as admin', async () => {
    const db = as('admin1');
    await assertFails(
      setDoc(
        doc(db, 'serials/13WAA00101A26'),
        excelSerial('admin1', 'Ada', { serial: '13WAA00101A26' }),
      ),
    );
    await assertFails(updateDoc(doc(db, 'serials/13WAA00101A26'), { part_no: 'X' }));
    await assertFails(deleteDoc(doc(db, 'serials/13WAA00101A26')));
  });
  it('excel serial must be attributed to the admin, with server time, active company', async () => {
    const db = as('admin1');
    await assertFails(
      setDoc(doc(db, 'serials/IMP-4'), excelSerial('op1', 'Oli', { serial: 'IMP-4' })),
    );
    await assertFails(
      setDoc(
        doc(db, 'serials/IMP-5'),
        excelSerial('admin1', 'Ada', { serial: 'IMP-5', scanned_at: new Date(0) }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, 'serials/IMP-6'),
        excelSerial('admin1', 'Ada', { serial: 'IMP-6', company_id: 'old', company: 'Old' }),
      ),
    );
  });
  it('import_history: admin can append and read; nobody can edit or delete', async () => {
    const db = as('admin1');
    await assertSucceeds(setDoc(doc(db, 'import_history/h1'), history('admin1', 'Ada')));
    await assertSucceeds(getDoc(doc(db, 'import_history/h1')));
    await assertSucceeds(
      getDocs(query(collection(db, 'import_history'), orderBy('imported_at', 'desc'), limit(20))),
    );
    await assertFails(updateDoc(doc(db, 'import_history/h1'), { new: 999 }));
    await assertFails(deleteDoc(doc(db, 'import_history/h1')));
  });
  it('import_history: validated (own uid/name, server time, non-negative integers, known status)', async () => {
    const db = as('admin1');
    await assertFails(setDoc(doc(db, 'import_history/b1'), history('op1', 'Oli')));
    await assertFails(setDoc(doc(db, 'import_history/b2'), history('admin1', 'Not Ada')));
    await assertFails(
      setDoc(doc(db, 'import_history/b3'), history('admin1', 'Ada', { imported_at: new Date(0) })),
    );
    await assertFails(setDoc(doc(db, 'import_history/b4'), history('admin1', 'Ada', { new: -1 })));
    await assertFails(setDoc(doc(db, 'import_history/b5'), history('admin1', 'Ada', { new: 1.5 })));
    await assertFails(
      setDoc(doc(db, 'import_history/b6'), history('admin1', 'Ada', { status: 'weird' })),
    );
    await assertFails(setDoc(doc(db, 'import_history/b7'), history('admin1', 'Ada', { extra: 1 })));
  });
  it('import_history: operators, signed-out, inactive and profile-less users have no access', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'import_history/h9'), { filename: 'x' });
    });
    for (const db of [as('op1'), anon(), as('off1'), as('ghost')]) {
      await assertFails(getDoc(doc(db, 'import_history/h9')));
      await assertFails(getDocs(collection(db, 'import_history')));
    }
    await assertFails(setDoc(doc(as('op1'), 'import_history/x'), history('op1', 'Oli')));
    await assertFails(setDoc(doc(anon(), 'import_history/y'), history('op1', 'Oli')));
  });
});

describe('serial export (full read) is admin-only', () => {
  const page = (db) => getDocs(query(collection(db, 'serials'), orderBy(documentId()), limit(10)));
  it('operator cannot run the paged export query, nor read every company', async () => {
    await assertFails(page(as('op1')));
    await assertFails(getDocs(collection(as('op1'), 'serials')));
    await assertFails(getDocs(collection(as('op1'), 'companies')));
  });
  it('unauthenticated, inactive and profile-less users cannot run it', async () => {
    await assertFails(page(anon()));
    await assertFails(page(as('off1')));
    await assertFails(page(as('ghost')));
  });
  it('admin can run it, and read all companies', async () => {
    await assertSucceeds(page(as('admin1')));
    await assertSucceeds(getDocs(collection(as('admin1'), 'companies')));
  });
  it('export does not need (and operators cannot get) other users or full scan_log', async () => {
    await assertFails(getDoc(doc(as('op1'), 'users/admin1')));
    await assertFails(getDocs(collection(as('op1'), 'users')));
  });
});

describe('admin', () => {
  it('reads all companies, other users, and lists serials', async () => {
    const db = as('admin1');
    await assertSucceeds(getDoc(doc(db, 'companies/old')));
    await assertSucceeds(getDoc(doc(db, 'users/op1')));
    await assertSucceeds(getDocs(collection(db, 'serials')));
  });
  it('can create/update companies and update users (attributed)', async () => {
    const db = as('admin1');
    await assertSucceeds(setDoc(doc(db, 'companies/new'), newCompany()));
    await assertSucceeds(updateDoc(doc(db, 'companies/new'), adminStamp({ active: false })));
    await assertSucceeds(updateDoc(doc(db, 'users/op1'), adminStamp({ active: false })));
  });
  it('still cannot edit or delete serials, or alter scan_log', async () => {
    const db = as('admin1');
    await assertFails(updateDoc(doc(db, 'serials/13WAA00101A26'), { part_no: 'X' }));
    await assertFails(deleteDoc(doc(db, 'serials/13WAA00101A26')));
    await assertFails(deleteDoc(doc(db, 'scan_log/log1')));
  });
});

// ---- Phase 9: admin administration ----
function adminStamp(fields, uid = 'admin1', name = 'Ada') {
  return { ...fields, updated_by: uid, updated_by_name: name, updated_at: serverTimestamp() };
}
function newCompany(over = {}) {
  return {
    id: 'new',
    name: 'New Co',
    code_type: 'qr',
    serial_format: 'ABC#####',
    active: true,
    created_at: serverTimestamp(),
    created_by: 'admin1',
    ...adminStamp({}),
    ...over,
  };
}

describe('companies: validation and attribution (Phase 9)', () => {
  it('rejects invalid create payloads', async () => {
    const db = as('admin1');
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ name: '' })));
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ name: 'x'.repeat(81) })));
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ code_type: 'hologram' })));
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ serial_format: '' })));
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ active: 'yes' })));
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ extra: 1 })));
    await assertFails(setDoc(doc(db, 'companies/other'), newCompany())); // id != doc id
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ created_by: 'op1' })));
    await assertFails(setDoc(doc(db, 'companies/new'), newCompany({ updated_by_name: 'Mallory' })));
  });
  it('cannot rewrite created_at / created_by, and cannot delete', async () => {
    const db = as('admin1');
    await assertSucceeds(setDoc(doc(db, 'companies/new'), newCompany()));
    await assertFails(updateDoc(doc(db, 'companies/new'), adminStamp({ created_at: new Date(0) })));
    await assertFails(updateDoc(doc(db, 'companies/new'), adminStamp({ created_by: 'op1' })));
    await assertFails(deleteDoc(doc(db, 'companies/new')));
    await assertFails(deleteDoc(doc(db, 'companies/company-a')));
  });
  it('operators, signed-out and inactive users cannot create or edit companies', async () => {
    for (const db of [as('op1'), anon(), as('off1'), as('ghost')]) {
      await assertFails(setDoc(doc(db, 'companies/new'), newCompany()));
      await assertFails(updateDoc(doc(db, 'companies/company-a'), adminStamp({ active: false })));
    }
  });
  it('editing a company does not touch serials or scan_log (they stay unchanged)', async () => {
    const db = as('admin1');
    await assertSucceeds(
      updateDoc(doc(db, 'companies/company-a'), adminStamp({ code_type: 'qr' })),
    );
    const s = await assertSucceeds(getDoc(doc(db, 'serials/13WAA00101A26')));
    if (s.data().company !== 'Company A') throw new Error('serial changed');
  });
});

describe('users administration (Phase 9)', () => {
  it('admin can change another user role/active with attribution', async () => {
    const db = as('admin1');
    await assertSucceeds(updateDoc(doc(db, 'users/op1'), adminStamp({ role: 'admin' })));
    await assertSucceeds(updateDoc(doc(db, 'users/off1'), adminStamp({ active: true })));
  });
  it('admin cannot change their OWN role or active status (last-admin protection)', async () => {
    const db = as('admin1');
    await assertFails(updateDoc(doc(db, 'users/admin1'), adminStamp({ role: 'operator' })));
    await assertFails(updateDoc(doc(db, 'users/admin1'), adminStamp({ active: false })));
  });
  it('rejects unattributed, forged-attribution, invalid-role and extra-field updates', async () => {
    const db = as('admin1');
    await assertFails(updateDoc(doc(db, 'users/op1'), { active: false }));
    await assertFails(
      updateDoc(doc(db, 'users/op1'), adminStamp({ active: false }, 'op2', 'Omar')),
    );
    await assertFails(updateDoc(doc(db, 'users/op1'), adminStamp({ role: 'superuser' })));
    await assertFails(updateDoc(doc(db, 'users/op1'), adminStamp({ name: 'Renamed' })));
    await assertFails(updateDoc(doc(db, 'users/op1'), adminStamp({ email: 'x@y.z' })));
    await assertFails(updateDoc(doc(db, 'users/op1'), adminStamp({ created_at: new Date(0) })));
  });
  it('nobody deletes users', async () => {
    await assertFails(deleteDoc(doc(as('admin1'), 'users/op1')));
  });
  it('operators, signed-out and inactive users cannot read the user list or change users', async () => {
    for (const db of [as('op1'), anon(), as('off1'), as('ghost')]) {
      await assertFails(getDocs(collection(db, 'users')));
      await assertFails(
        updateDoc(doc(db, 'users/op2'), adminStamp({ active: false }, 'op1', 'Oli')),
      );
      await assertFails(
        updateDoc(doc(db, 'users/op1'), adminStamp({ role: 'admin' }, 'op1', 'Oli')),
      );
    }
    await assertSucceeds(getDocs(collection(as('admin1'), 'users')));
  });
});

describe('export_history (Phase 9)', () => {
  const entry = (over = {}) => ({
    filename: 'serials.xlsx',
    exported_by: 'admin1',
    exported_by_name: 'Ada',
    exported_at: serverTimestamp(),
    record_count: 3,
    ...over,
  });
  it('admin can append a valid, attributed entry and read the list', async () => {
    const db = as('admin1');
    await assertSucceeds(setDoc(doc(db, 'export_history/e1'), entry()));
    await assertSucceeds(getDocs(collection(db, 'export_history')));
  });
  it('rejects forged attribution, bad counts and extra fields; entries are immutable', async () => {
    const db = as('admin1');
    await assertFails(setDoc(doc(db, 'export_history/e2'), entry({ exported_by: 'op1' })));
    await assertFails(setDoc(doc(db, 'export_history/e2'), entry({ exported_by_name: 'Mallory' })));
    await assertFails(setDoc(doc(db, 'export_history/e2'), entry({ record_count: -1 })));
    await assertFails(setDoc(doc(db, 'export_history/e2'), entry({ record_count: 1.5 })));
    await assertFails(setDoc(doc(db, 'export_history/e2'), entry({ exported_at: new Date(0) })));
    await assertFails(setDoc(doc(db, 'export_history/e2'), entry({ extra: true })));
    await assertSucceeds(setDoc(doc(db, 'export_history/e3'), entry()));
    await assertFails(updateDoc(doc(db, 'export_history/e3'), { record_count: 9 }));
    await assertFails(deleteDoc(doc(db, 'export_history/e3')));
  });
  it('operators, signed-out and inactive users have no access', async () => {
    for (const db of [as('op1'), anon(), as('off1'), as('ghost')]) {
      await assertFails(setDoc(doc(db, 'export_history/x'), entry({ exported_by: 'op1' })));
      await assertFails(getDocs(collection(db, 'export_history')));
    }
  });
});

describe('scan history (scan_log) access (Phase 9)', () => {
  const adminQuery = (db) =>
    getDocs(
      query(
        collection(db, 'scan_log'),
        where('result', '==', 'new'),
        orderBy('timestamp', 'desc'),
        limit(25),
      ),
    );
  it('admin can run filtered, ordered, limited history queries', async () => {
    await assertSucceeds(adminQuery(as('admin1')));
  });
  // Design (Phase 2): the operator "Recent scans" list is shared on the shop floor, so active
  // staff can READ scan_log. The admin history UI is still admin-only (route guard); scan_log
  // is append-only for everyone.
  it('signed-out, inactive and profile-less users cannot read scan history', async () => {
    for (const db of [anon(), as('off1'), as('ghost')]) {
      await assertFails(adminQuery(db));
      await assertFails(getDoc(doc(db, 'scan_log/log1')));
    }
  });
  it('operators cannot alter scan history', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'scan_log/log1'), { result: 'duplicate' }));
    await assertFails(deleteDoc(doc(as('op1'), 'scan_log/log1')));
  });
});

function validSerial(uid, name, serial = undefined) {
  return {
    serial: serial ?? '13WAA000000001',
    part_no: '',
    company: 'Company A',
    company_id: 'company-a',
    source: 'manual',
    scanned_at: serverTimestamp(),
    scanned_by: uid,
    scanned_by_name: name,
  };
}

function validLog(uid, name, serial, result) {
  return {
    serial,
    result,
    company: 'Company A',
    company_id: 'company-a',
    source: 'manual',
    scanned_by: uid,
    scanned_by_name: name,
    timestamp: serverTimestamp(),
  };
}

describe('Phase 11 final security audit (direct Firestore access, no UI)', () => {
  const batchFor = (db, uid, name, serial) => {
    const b = writeBatch(db);
    b.set(doc(db, 'serials/' + serial), validSerial(uid, name, serial));
    b.set(doc(db, 'scan_log/audit-' + serial), validLog(uid, name, serial, 'new'));
    return b;
  };

  it('nobody can create their own profile or an admin profile: a signed-in user without a profile, and operators, are refused', async () => {
    const adminProfile = {
      name: 'Eve',
      email: 'eve@x.test',
      role: 'admin',
      active: true,
      created_at: serverTimestamp(),
    };
    await assertFails(setDoc(doc(as('ghost'), 'users/ghost'), adminProfile));
    await assertFails(setDoc(doc(as('op1'), 'users/op1x'), adminProfile));
    await assertFails(
      setDoc(doc(as('op1'), 'users/op1'), { ...user('Oli', 'operator'), role: 'admin' }),
    );
    await assertFails(setDoc(doc(anon(), 'users/anon'), adminProfile));
  });

  it('an admin cannot create a user with a role other than operator/admin', async () => {
    await assertFails(
      setDoc(doc(as('admin1'), 'users/new1'), { ...user('N', 'operator'), role: 'superuser' }),
    );
    await assertSucceeds(setDoc(doc(as('admin1'), 'users/new2'), user('N2', 'operator')));
  });

  it('default deny: unknown collections are closed to everyone, admins included', async () => {
    for (const db of [as('admin1'), as('op1'), anon()]) {
      await assertFails(setDoc(doc(db, 'secrets/x'), { a: 1 }));
      await assertFails(getDoc(doc(db, 'secrets/x')));
    }
  });

  it('the serial document ID must equal the serial field', async () => {
    const db = as('op1');
    const b = writeBatch(db);
    b.set(doc(db, 'serials/ID-ONE'), validSerial('op1', 'Oli', 'ID-TWO'));
    b.set(doc(db, 'scan_log/mismatch'), validLog('op1', 'Oli', 'ID-ONE', 'new'));
    await assertFails(b.commit());
  });

  it('serial length: exactly 100 characters registers, 101 is refused by the rules', async () => {
    const db = as('op1');
    await assertSucceeds(batchFor(db, 'op1', 'Oli', 'K'.repeat(100)).commit());
    await assertFails(batchFor(db, 'op1', 'Oli', 'K'.repeat(101)).commit());
  });

  it('an operator cannot smuggle a company or user change into a registration batch (all-or-nothing)', async () => {
    const db = as('op1');
    const b = batchFor(db, 'op1', 'Oli', 'SMUGGLE-1');
    b.update(doc(db, 'companies/company-a'), { code_type: 'qr' });
    await assertFails(b.commit());
    const b2 = batchFor(db, 'op1', 'Oli', 'SMUGGLE-2');
    b2.update(doc(db, 'users/op1'), { role: 'admin' });
    await assertFails(b2.commit());
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      if ((await getDoc(doc(d, 'serials/SMUGGLE-1'))).exists())
        throw new Error('partial write leaked');
      if ((await getDoc(doc(d, 'companies/company-a'))).data().code_type !== 'barcode')
        throw new Error('company changed');
      if ((await getDoc(doc(d, 'users/op1'))).data().role !== 'operator')
        throw new Error('role changed');
    });
  });

  it('admins cannot forge history either: a NEW log without its serial, or a log attributed to someone else', async () => {
    const db = as('admin1');
    await assertFails(
      setDoc(doc(db, 'scan_log/forged1'), validLog('admin1', 'Ada', 'NO-SUCH-SERIAL', 'new')),
    );
    await assertFails(
      setDoc(doc(db, 'scan_log/forged2'), validLog('op1', 'Oli', '13WAA00101A26', 'duplicate')),
    );
    await assertFails(updateDoc(doc(db, 'scan_log/log1'), { result: 'duplicate' }));
    await assertFails(deleteDoc(doc(db, 'scan_log/log1')));
  });

  it('a deactivated company cannot be used for a new registration, even by a hand-built request', async () => {
    const db = as('op1');
    const b = writeBatch(db);
    b.set(doc(db, 'serials/OLDCO-1'), {
      ...validSerial('op1', 'Oli', 'OLDCO-1'),
      company: 'Old',
      company_id: 'old',
    });
    b.set(doc(db, 'scan_log/oldco-1'), {
      ...validLog('op1', 'Oli', 'OLDCO-1', 'new'),
      company: 'Old',
      company_id: 'old',
    });
    await assertFails(b.commit());
  });

  it('a user deactivated mid-session loses write and read access immediately', async () => {
    const db = as('op2');
    await assertSucceeds(getDocs(query(collection(db, 'companies'), where('active', '==', true))));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/op2'), { active: false });
    });
    await assertFails(getDocs(query(collection(db, 'companies'), where('active', '==', true))));
    await assertFails(batchFor(db, 'op2', 'Omar', 'AFTER-DEACT').commit());
    await assertSucceeds(getDoc(doc(db, 'users/op2'))); // may still read its OWN profile, to be told why
  });

  it('a demoted admin immediately loses admin powers', async () => {
    const db = as('admin1');
    await assertSucceeds(getDocs(collection(db, 'serials')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/admin1'), { role: 'operator' });
    });
    await assertFails(getDocs(collection(db, 'serials')));
    await assertFails(updateDoc(doc(db, 'users/op1'), adminStamp({ active: false })));
  });
});

describe('display preferences (language / theme) on the own profile', () => {
  const prefs = (language, theme) => ({ preferences: { language, theme } });

  it('an active user can save their own language and theme', async () => {
    await assertSucceeds(updateDoc(doc(as('op1'), 'users/op1'), prefs('mr', 'dark')));
    await assertSucceeds(updateDoc(doc(as('op1'), 'users/op1'), prefs('hi', 'light')));
    await assertSucceeds(
      updateDoc(doc(as('op1'), 'users/op1'), { preferences: { language: 'en' } }),
    );
    // admins too (their own account; the admin-only rule still forbids self role/active changes)
    await assertSucceeds(updateDoc(doc(as('admin1'), 'users/admin1'), prefs('en', 'dark')));
  });

  it('only known values are accepted', async () => {
    await assertFails(updateDoc(doc(as('op1'), 'users/op1'), prefs('fr', 'dark')));
    await assertFails(updateDoc(doc(as('op1'), 'users/op1'), prefs('mr', 'neon')));
    await assertFails(
      updateDoc(doc(as('op1'), 'users/op1'), {
        preferences: { language: 'mr', theme: 'dark', role: 'admin' },
      }),
    );
    await assertFails(updateDoc(doc(as('op1'), 'users/op1'), { preferences: 'dark' }));
  });

  it('cannot be used to change role or ANY other field on the own user record', async () => {
    // Every other field a users/{uid} document has (or could be given), each changed alongside a
    // valid preferences update: all must be refused, for an operator and for an admin.
    const otherFields = {
      role: 'admin',
      active: false,
      name: 'X',
      email: 'x@example.test',
      created_at: new Date(2000, 0, 1),
      updated_at: serverTimestamp(),
      updated_by: 'op1',
      updated_by_name: 'Oli',
      anything_new: true,
    };
    for (const [field, value] of Object.entries(otherFields)) {
      await assertFails(
        updateDoc(doc(as('op1'), 'users/op1'), { ...prefs('mr', 'dark'), [field]: value }),
      );
      await assertFails(
        updateDoc(doc(as('admin1'), 'users/admin1'), {
          ...prefs('mr', 'dark'),
          [field]: field === 'role' ? 'operator' : value,
        }),
      );
    }
    // ...and the record really is unchanged afterwards.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'users/op1'));
      const d = snap.data();
      if (d.role !== 'operator' || d.active !== true || d.name !== 'Oli' || 'anything_new' in d) {
        throw new Error('profile was modified');
      }
    });
  });

  it("nobody can change another user's preferences, and signed-out or inactive users cannot save", async () => {
    await assertFails(updateDoc(doc(as('op1'), 'users/op2'), prefs('mr', 'dark')));
    await assertFails(updateDoc(doc(as('admin1'), 'users/op1'), prefs('mr', 'dark')));
    await assertFails(updateDoc(doc(anon(), 'users/op1'), prefs('mr', 'dark')));
    await assertFails(updateDoc(doc(as('off1'), 'users/off1'), prefs('mr', 'dark')));
  });
});
