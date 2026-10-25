import { describe, expect, it } from 'vitest';
import {
  classifyAgainstFirestore,
  compareWithExisting,
  countRows,
  normalizeRows,
  resolveCompany,
} from '../src/services/excel/importClassify';
import type { ExistingSerialInfo, RawImportRow } from '../src/services/excel/importTypes';
import type { Company } from '../src/types';

const co = (id: string, name: string, active = true): Company => ({
  id,
  name,
  codeType: 'barcode',
  serialFormat: '',
  active,
  createdAt: null,
  updatedAt: null,
});
const COMPANIES = [
  co('company-a', 'Company A'),
  co('company-b', 'Company B'),
  co('old', 'Old Co', false),
];

let n = 1;
const raw = (serial: string, partNo = '', company = 'Company A', companyId = ''): RawImportRow => ({
  rowNumber: ++n,
  serial,
  partNo,
  company,
  companyId,
  problems: [],
});
const existing = (
  serial: string,
  companyId: string,
  company: string,
  partNo = '',
): ExistingSerialInfo => ({
  serial,
  companyId,
  company,
  partNo,
});

describe('normalizeRows', () => {
  it('normalizes serials like manual entry (trim + upper-case) without touching look-alikes', () => {
    const { rows } = normalizeRows([raw('  ab-0O1I  ', '  PN 1 ')], COMPANIES);
    expect(rows[0]).toMatchObject({
      serial: 'AB-0O1I',
      partNo: 'PN 1',
      cls: 'new',
      companyId: 'company-a',
    });
  });

  it('classifies INVALID rows with a reason and never looks them up', () => {
    const bad: RawImportRow[] = [
      raw(''),
      raw('A/B'),
      raw('X'.repeat(101)),
      raw('OK-1', 'P'.repeat(101)),
      raw('OK-2', '', 'Nope Co'),
      raw('OK-3', '', ''),
      raw('OK-4', '', 'Old Co'),
      { ...raw('OK-5'), problems: ['Serial Number: Unexpected date value.'] },
    ];
    const { rows, serialsToCheck } = normalizeRows(bad, COMPANIES);
    expect(rows.every((r) => r.cls === 'invalid')).toBe(true);
    expect(rows.map((r) => r.reason)).toEqual([
      'Serial number is missing.',
      expect.stringContaining('not allowed'),
      expect.stringContaining('longer than 100'),
      expect.stringContaining('Part number is longer'),
      'Unknown company "Nope Co".',
      'Company is missing.',
      'Company "Old Co" is inactive.',
      'Serial Number: Unexpected date value.',
    ]);
    expect(serialsToCheck).toEqual([]);
  });

  it('detects duplicates inside the file (same normalized serial), first occurrence wins', () => {
    const a = raw('abc123', 'P1');
    const b = raw('ZZZ');
    const c = raw(' ABC123 ', 'P2', 'Company B'); // same serial after normalization, different data
    const { rows, serialsToCheck } = normalizeRows([a, b, c], COMPANIES);
    expect(rows.map((r) => r.cls)).toEqual(['new', 'new', 'duplicate']);
    expect(rows[2]).toMatchObject({ duplicateOfRow: a.rowNumber });
    expect(rows[2]?.reason).toContain(`row ${a.rowNumber}`);
    expect(serialsToCheck).toEqual(['ABC123', 'ZZZ']); // each unique serial looked up once
  });

  it('an invalid first occurrence does not claim the serial', () => {
    const { rows } = normalizeRows([raw('S-1', '', 'Nope'), raw('S-1')], COMPANIES);
    expect(rows.map((r) => r.cls)).toEqual(['invalid', 'new']);
  });
});

describe('resolveCompany', () => {
  it('resolves by name, id, either column, case-insensitively', () => {
    expect(resolveCompany(COMPANIES, '', 'company a')).toMatchObject({ ok: true });
    expect(resolveCompany(COMPANIES, '', 'COMPANY-B')).toMatchObject({
      ok: true,
      company: { id: 'company-b' },
    });
    expect(resolveCompany(COMPANIES, 'company-a', '')).toMatchObject({ ok: true });
    expect(resolveCompany(COMPANIES, 'company-a', 'Company A')).toMatchObject({ ok: true });
  });
  it('rejects unknown, disagreeing, ambiguous and inactive companies', () => {
    expect(resolveCompany(COMPANIES, 'x', '')).toMatchObject({ ok: false });
    expect(resolveCompany(COMPANIES, 'company-a', 'Company B')).toMatchObject({ ok: false });
    expect(resolveCompany([co('1', 'Dup'), co('2', 'Dup')], '', 'Dup')).toMatchObject({
      ok: false,
    });
    expect(resolveCompany(COMPANIES, 'old', '')).toMatchObject({ ok: false });
  });
});

describe('classifyAgainstFirestore', () => {
  const run = (rows: RawImportRow[], ex: ExistingSerialInfo[]) => {
    const norm = normalizeRows(rows, COMPANIES);
    return classifyAgainstFirestore(norm, new Map(ex.map((e) => [e.serial, e])));
  };

  it('NEW when the serial does not exist', () => {
    expect(run([raw('N-1')], [])[0]?.cls).toBe('new');
  });
  it('EXISTING / SKIPPED when Firestore agrees', () => {
    const r = run([raw('E-1', 'PN-1')], [existing('E-1', 'company-a', 'Company A', 'PN-1')]);
    expect(r[0]).toMatchObject({ cls: 'existing', existing: { serial: 'E-1' } });
  });
  it('blank part number in the file never conflicts', () => {
    expect(run([raw('E-2', '')], [existing('E-2', 'company-a', 'Company A', 'PN-9')])[0]?.cls).toBe(
      'existing',
    );
  });
  it('CONFLICT when the company differs (shows both values)', () => {
    const r = run(
      [raw('C-1', 'PART-01', 'Company B')],
      [existing('C-1', 'company-a', 'Company A', 'PART-01')],
    );
    expect(r[0]?.cls).toBe('conflict');
    expect(r[0]?.reason).toBe('Company differs (file: Company B, Firestore: Company A)');
    expect(r[0]?.existing).toMatchObject({ company: 'Company A', partNo: 'PART-01' });
  });
  it('CONFLICT when the part number differs (the ABC123 example from the spec)', () => {
    const r = run(
      [raw('ABC123', 'PART-99', 'Company B')],
      [existing('ABC123', 'company-a', 'Company A', 'PART-01')],
    );
    expect(r[0]?.cls).toBe('conflict');
    expect(r[0]?.reason).toContain('Company differs');
    expect(r[0]?.reason).toContain('Part number differs (file: PART-99, Firestore: PART-01)');
  });
  it('CONFLICT when the file has a part number and Firestore has none', () => {
    expect(run([raw('C-2', 'PN-1')], [existing('C-2', 'company-a', 'Company A', '')])[0]?.cls).toBe(
      'conflict',
    );
  });

  it('every row gets exactly one class: counts add up', () => {
    const rows = run(
      [
        raw('N-1'),
        raw('E-1'),
        raw('C-1', '', 'Company B'),
        raw('N-1'),
        raw(''),
        raw('X-9', '', 'Nope'),
      ],
      [existing('E-1', 'company-a', 'Company A'), existing('C-1', 'company-a', 'Company A')],
    );
    const c = countRows(rows);
    expect(c).toEqual({
      total: 6,
      valid: 4,
      new: 1,
      existing: 1,
      conflict: 1,
      duplicate: 1,
      invalid: 2,
    });
    expect(c.new + c.existing + c.conflict + c.duplicate + c.invalid).toBe(c.total);
  });
});

describe('compareWithExisting', () => {
  it('is the single comparison used for preview and write time', () => {
    const row = { companyId: 'company-a', companyName: 'Company A', partNo: 'P' };
    expect(compareWithExisting(row, existing('S', 'company-a', 'Company A', 'P'))).toEqual({
      compatible: true,
    });
    expect(compareWithExisting(row, existing('S', 'company-b', 'Company B', 'P'))).toMatchObject({
      compatible: false,
    });
  });
});
