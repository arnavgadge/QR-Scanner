// DEVELOPMENT SEED — local Firebase emulators only. Never touches a real project.
// Usage: npm run emulators (one terminal), then npm run seed:dev (another).
// Creates: Company A/B, dev users (admin + operator), one serial, a few scan_log entries.
// Dev-only credentials below are for the emulator and are meaningless elsewhere.

// Forcing these makes the Admin SDK talk to the emulators regardless of other credentials.
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-vicimus';
initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();
const now = FieldValue.serverTimestamp();

const users = [
  { uid: 'dev-admin', name: 'Dev Admin', email: 'admin@example.test', role: 'admin' },
  { uid: 'dev-operator', name: 'Dev Operator', email: 'operator@example.test', role: 'operator' },
];

for (const u of users) {
  await auth.deleteUser(u.uid).catch(() => undefined);
  await auth.createUser({
    uid: u.uid,
    email: u.email,
    password: 'devpassword123',
    displayName: u.name,
  });
  await db.doc(`users/${u.uid}`).set({
    uid: u.uid,
    name: u.name,
    email: u.email,
    role: u.role,
    active: true,
    created_at: now,
  });
}

const companies = [
  { id: 'company-a', name: 'Company A', code_type: 'barcode', serial_format: '13WAA#########' },
  { id: 'company-b', name: 'Company B', code_type: 'qr', serial_format: '27BXX#######' },
];
for (const c of companies) {
  await db.doc(`companies/${c.id}`).set({ ...c, active: true, created_at: now, updated_at: now });
}

await db.doc('serials/13WAA00101A26').set({
  serial: '13WAA00101A26',
  part_no: '',
  company: 'Company A',
  company_id: 'company-a',
  source: 'manual',
  scanned_at: now,
  scanned_by: 'dev-operator',
  scanned_by_name: 'Dev Operator',
});

const log = (serial, result, company, company_id, offsetMin) => ({
  serial,
  result,
  company,
  company_id,
  source: 'manual',
  scanned_by: 'dev-operator',
  scanned_by_name: 'Dev Operator',
  timestamp: new Date(Date.now() - offsetMin * 60_000),
});
await db.collection('scan_log').add(log('13WAA00101A26', 'new', 'Company A', 'company-a', 10));
await db.collection('scan_log').add(log('13WAA00101A26', 'duplicate', 'Company A', 'company-a', 5));
await db.collection('scan_log').add(log('27BXX0000001', 'new', 'Company B', 'company-b', 2));

console.log(
  'Seeded emulators: admin@example.test / operator@example.test (password: devpassword123)',
);
