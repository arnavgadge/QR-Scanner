// Generates sample Excel files for trying the admin Import page.
// Usage: node scripts/make-sample-sheets.mjs
//   sample-data/both-companies-2tabs.xlsx   ONE workbook, tab "Company A" + tab "Company B", 100 rows each
//   sample-data/company-a-100.xlsx / company-b-100.xlsx   single-tab files (older ranges)
import { mkdirSync } from 'node:fs';
import ExcelJS from 'exceljs';

const pad = (n, w) => String(n).padStart(w, '0');
const HEADERS = ['Serial Number', 'Part Number', 'Company'];

// Company A format: 13WAA + 9 digits.
function companyA(range) {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push(`13WAA${pad(range + i, 9)}`); // running block
  for (let i = 0; i < 20; i++) rows.push(`13WAA${pad(range + 1000 + i * 10, 9)}`); // steps of 10
  for (let i = 0; i < 20; i++) rows.push(`13WAA0${pad(Math.floor(range / 10) + i * 7, 8)}`); // leading-zero block
  return rows.map((s, i) => [s, `PN-A-${pad(i + 1, 4)}`, 'Company A']);
}

// Company B format: 27BXX + 7 digits.
function companyB(range) {
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push(`27BXX${pad(range + i, 7)}`); // running block
  for (let i = 0; i < 25; i++) rows.push(`27BXX${pad(range + 1000 + i * 25, 7)}`); // steps of 25
  for (let i = 0; i < 25; i++) rows.push(`27BXX00${pad(Math.floor(range / 100) + i * 3, 5)}`); // leading-zero block
  return rows.map((s, i) => [s, `PN-B-${pad(i + 1, 4)}`, 'Company B']);
}

function addTab(wb, name, rows) {
  const ws = wb.addWorksheet(name);
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 22 }, { width: 16 }, { width: 14 }];
  for (const r of rows) ws.addRow(r).getCell(1).numFmt = '@'; // keep serials as text
}

async function write(file, tabs) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of tabs) addTab(wb, name, rows);
  await wb.xlsx.writeFile(file);
  for (const [name, rows] of tabs) {
    console.log(
      `${file} [${name}]: ${rows.length} rows, ${new Set(rows.map((r) => r[0])).size} unique, ${rows[0][0]} .. ${rows[rows.length - 1][0]}`,
    );
  }
}

mkdirSync('sample-data', { recursive: true });
// New ranges (4xxxxxxxx / 7xxxxxx) so this file imports as NEW even after the older sample files.
await write('sample-data/both-companies-2tabs.xlsx', [
  ['Company A', companyA(410000001)],
  ['Company B', companyB(7100001)],
]);
await write('sample-data/company-a-100.xlsx', [['Company A', companyA(310000001)]]);
await write('sample-data/company-b-100.xlsx', [['Company B', companyB(5100001)]]);
