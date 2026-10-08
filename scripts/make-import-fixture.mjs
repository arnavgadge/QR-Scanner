// DEV/TEST ONLY: writes tests/fixtures/import-sample.xlsx, a small deterministic workbook for
// trying the Excel import against the seeded emulator data (npm run seed:dev). Not used in production.
// Run: node scripts/make-import-fixture.mjs
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';

const rows = [
  // Serial Number, Part Number, Company                -> expected classification vs seed data
  ['13WAA000010001', 'PN-100', 'Company A'], //            NEW
  ['13WAA000010002', 'PN-101', 'Company A'], //            NEW
  ['27BXX0010001', 'PN-300', 'Company B'], //              NEW
  ['13WAA000000001', '', 'Company A'], //                  EXISTING (matches the seeded serial)
  ['13WAA000000001', 'PN-99', 'Company A'], //             DUPLICATE WITHIN UPLOAD (repeats row 5)
  ['27BXX0000001', 'PN-200', 'Company A'], //              CONFLICT (Firestore has Company B)
  ['', 'PN-1', 'Company A'], //                            INVALID (missing serial)
  ['13WAA000010003', 'PN-102', 'No Such Company'], //      INVALID (unknown company)
];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Serial Records');
ws.addRow(['Serial Number', 'Part Number', 'Company']);
for (const r of rows) ws.addRow(r);
mkdirSync('tests/fixtures', { recursive: true });
await wb.xlsx.writeFile('tests/fixtures/import-sample.xlsx');
console.log(
  'Wrote tests/fixtures/import-sample.xlsx (8 data rows: 3 new, 1 existing, 1 duplicate, 1 conflict, 2 invalid)',
);
