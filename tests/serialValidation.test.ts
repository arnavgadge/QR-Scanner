// Phase 11: manual entry, OCR-confirmed entry and Excel import must obey the SAME serial rules.
import { describe, expect, it } from 'vitest';
import { normalizeRows } from '../src/services/excel/importClassify';
import type { RawImportRow } from '../src/services/excel/importTypes';
import { verifySerial, type VerifyDeps } from '../src/services/serial/serialVerification';
import {
  MAX_SERIAL_LENGTH,
  serialIdProblem,
  serialValueProblem,
} from '../src/services/serial/serialValidation';
import type { Company } from '../src/types';

const company = (id: string, codeType: 'barcode' | 'qr'): Company => ({
  id,
  name: id.toUpperCase(),
  codeType,
  serialFormat: '', // legacy / free format: only the shared rules apply
  active: true,
  createdAt: null,
  updatedAt: null,
});
const BC = company('bc', 'barcode');
const QR = company('qr', 'qr');

// A database that must NEVER be reached for values the shared rules reject.
const deps = (c: Company): VerifyDeps => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error('Firestore must not be touched');
      },
    },
  ) as never,
  loadActor: async () => ({ uid: 'u1', name: 'Op' }),
  loadCompany: async () => c,
});
const raw = (serial: string, n = 2): RawImportRow => ({
  rowNumber: n,
  serial,
  partNo: '',
  company: 'BC',
  companyId: '',
  problems: [],
});

describe('shared serial value rules', () => {
  const REJECTED = [
    ['over the length limit', 'X'.repeat(MAX_SERIAL_LENGTH + 1)],
    ['a slash', 'A/B'],
    ['a single dot', '.'],
    ['two dots', '..'],
    ['a reserved __name__', '__SERIAL__'],
  ] as const;
  const ACCEPTED = [
    ['exactly 100 characters', 'X'.repeat(MAX_SERIAL_LENGTH)],
    ['leading zeros', '00012345'],
    ['hyphen and underscore', 'AB-12_CD'],
    ['non-ASCII text (storable; only barcode LABELS need ASCII)', 'ÉCOLE-42'],
  ] as const;

  for (const [label, value] of REJECTED) {
    it(`rejects ${label}: identically for manual/OCR and for Excel rows, before any write`, async () => {
      expect(serialValueProblem(value), label).not.toBeNull();
      const manual = await verifySerial(deps(BC), {
        serial: value,
        companyId: 'bc',
        source: 'manual',
      });
      expect(manual.result).toBe('invalid');
      const ocr = await verifySerial(deps(BC), { serial: value, companyId: 'bc', source: 'scan' });
      expect(ocr.result).toBe('invalid');
      const imp = normalizeRows([raw(value)], [BC]);
      expect(imp.rows[0]?.cls).toBe('invalid');
      expect(imp.serialsToCheck).toEqual([]);
      // one wording everywhere
      const imported = imp.rows[0]!.reason;
      expect(manual.result === 'invalid' && manual.message).toBe(imported);
    });
  }
  for (const [label, value] of ACCEPTED) {
    it(`accepts ${label} in the shared rules (and Excel treats it as a candidate)`, () => {
      expect(serialValueProblem(value), label).toBeNull();
      const imp = normalizeRows([raw(value)], [BC]);
      expect(imp.rows[0]?.cls).toBe('new');
    });
  }

  it('a mixed file: only the over-length / unsafe rows are invalid, valid rows stay importable', () => {
    const r = normalizeRows(
      [
        raw('GOOD-001', 2),
        raw('X'.repeat(101), 3),
        raw('GOOD-002', 4),
        raw('A/B', 5),
        raw('00012345', 6),
        raw('GOOD-001', 7),
      ],
      [BC],
    );
    expect(r.rows.map((x) => x.cls)).toEqual([
      'new',
      'invalid',
      'new',
      'invalid',
      'new',
      'duplicate',
    ]);
    expect(r.serialsToCheck).toEqual(['GOOD-001', 'GOOD-002', '00012345']);
    expect(r.rows[1]?.reason).toMatch(/longer than 100/);
    expect(r.rows[3]?.reason).toMatch(/not allowed/);
  });

  it('manual entry additionally refuses what the company LABEL cannot encode, so no serial is consumed unlabelable', async () => {
    for (const bad of ['B'.repeat(81), 'ÉCOLE-42']) {
      const r = await verifySerial(deps(BC), { serial: bad, companyId: 'bc', source: 'manual' });
      expect(r.result, bad).toBe('invalid');
    }
    // a QR label carries both; they pass validation and only then reach the (unreachable here) database
    await expect(
      verifySerial(deps(QR), { serial: 'ÉCOLE-42', companyId: 'qr', source: 'manual' }),
    ).resolves.toMatchObject({ result: 'error' }); // reached the database stub => validation passed
  });

  it('serialIdProblem is the single document-id check', () => {
    expect(serialIdProblem('OK-1')).toBeNull();
    expect(serialIdProblem('')).not.toBeNull();
  });
});
