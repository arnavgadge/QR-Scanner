import { normalizeSerial } from '../../utils/serial';
import type { Company } from '../../types';
import { MAX_PART_LENGTH, serialValueProblem } from '../serial/serialValidation';
import type { ClassifiedRow, ExistingSerialInfo, ImportCounts, RawImportRow } from './importTypes';

export type CompanyResolution = { ok: true; company: Company } | { ok: false; reason: string };

/** Resolves the Company / Company ID cells to one active company. */
export function resolveCompany(
  companies: Company[],
  idCell: string,
  nameCell: string,
): CompanyResolution {
  const lc = (s: string) => s.trim().toLowerCase();
  const byId = (v: string) => companies.filter((c) => lc(c.id) === lc(v));
  const byNameOrId = (v: string) =>
    companies.filter((c) => lc(c.name) === lc(v) || lc(c.id) === lc(v));

  let found: Company[];
  if (idCell) {
    found = byId(idCell);
    if (found.length === 0) return { ok: false, reason: `Unknown company ID "${idCell}".` };
    if (nameCell) {
      const named = byNameOrId(nameCell);
      if (named.length > 0 && !named.some((c) => c.id === found[0]?.id)) {
        return {
          ok: false,
          reason: `Company "${nameCell}" does not match Company ID "${idCell}".`,
        };
      }
    }
  } else if (nameCell) {
    found = byNameOrId(nameCell);
    if (found.length === 0) return { ok: false, reason: `Unknown company "${nameCell}".` };
    if (found.length > 1) return { ok: false, reason: `Company "${nameCell}" is ambiguous.` };
  } else {
    return { ok: false, reason: 'Company is missing.' };
  }
  const company = found[0] as Company;
  if (!company.active) return { ok: false, reason: `Company "${company.name}" is inactive.` };
  return { ok: true, company };
}

/**
 * Same rule at preview time and at write time. A blank part number in the file makes no claim
 * and never conflicts; otherwise company and part number must match the stored record.
 */
export function compareWithExisting(
  row: { companyId: string; companyName: string; partNo: string },
  existing: ExistingSerialInfo,
): { compatible: true } | { compatible: false; reason: string } {
  const reasons: string[] = [];
  if (row.companyId !== existing.companyId) {
    reasons.push(`Company differs (file: ${row.companyName}, Firestore: ${existing.company})`);
  }
  if (row.partNo !== '' && row.partNo !== existing.partNo) {
    reasons.push(
      `Part number differs (file: ${row.partNo}, Firestore: ${existing.partNo || '(blank)'})`,
    );
  }
  return reasons.length === 0
    ? { compatible: true }
    : { compatible: false, reason: reasons.join('; ') };
}

/** A valid, first-occurrence row: the only kind that is looked up in Firestore. */
export interface CandidateRow extends ClassifiedRow {
  cls: 'new';
}

export interface NormalizedImport {
  /** Every row, in file order; candidates start as 'new' pending the Firestore comparison. */
  rows: ClassifiedRow[];
  /** Unique normalized serials to look up in Firestore. */
  serialsToCheck: string[];
}

/**
 * Pure, local pass: normalize, validate, resolve companies and detect duplicates inside the
 * file. No Firestore access. The first occurrence of a serial is kept for comparison; later
 * occurrences are DUPLICATE WITHIN UPLOAD (never written).
 */
export function normalizeRows(raw: RawImportRow[], companies: Company[]): NormalizedImport {
  const rows: ClassifiedRow[] = [];
  const firstRowOf = new Map<string, { row: number; sheet: string }>();

  for (const r of raw) {
    const serial = normalizeSerial(r.serial);
    const partNo = r.partNo.trim();
    const base = {
      rowNumber: r.rowNumber,
      ...(r.sheet !== undefined ? { sheet: r.sheet } : {}),
      serial,
      partNo,
      companyId: r.companyId.trim(),
      companyName: (r.company || r.companyId).trim(),
    };
    const invalid = (reason: string): ClassifiedRow => ({ ...base, cls: 'invalid', reason });

    if (r.problems.length > 0) {
      rows.push(invalid(r.problems.join(' ')));
      continue;
    }
    if (!serial) {
      rows.push(invalid('Serial number is missing.'));
      continue;
    }
    // The same value rules as manual entry / OCR (length, storable as a document ID).
    const valueProblem = serialValueProblem(serial);
    if (valueProblem) {
      rows.push(invalid(valueProblem.message));
      continue;
    }
    if (partNo.length > MAX_PART_LENGTH) {
      rows.push(invalid(`Part number is longer than ${MAX_PART_LENGTH} characters.`));
      continue;
    }
    const resolved = resolveCompany(companies, r.companyId.trim(), r.company.trim());
    if (!resolved.ok) {
      rows.push(invalid(resolved.reason));
      continue;
    }
    const company = resolved.company;
    const row: ClassifiedRow = {
      ...base,
      companyId: company.id,
      companyName: company.name,
      cls: 'new',
      reason: '',
    };

    const earlier = firstRowOf.get(serial);
    if (earlier !== undefined) {
      const elsewhere = earlier.sheet !== (r.sheet ?? '') ? ` on sheet "${earlier.sheet}"` : '';
      rows.push({
        ...row,
        cls: 'duplicate',
        duplicateOfRow: earlier.row,
        reason: `Same serial as row ${earlier.row}${elsewhere}.`,
      });
      continue;
    }
    firstRowOf.set(serial, { row: r.rowNumber, sheet: r.sheet ?? '' });
    rows.push(row);
  }

  return {
    rows,
    serialsToCheck: rows.filter((r) => r.cls === 'new').map((r) => r.serial),
  };
}

/** Applies Firestore's current state to the candidate rows. */
export function classifyAgainstFirestore(
  normalized: NormalizedImport,
  existing: Map<string, ExistingSerialInfo>,
): ClassifiedRow[] {
  return normalized.rows.map((row) => {
    if (row.cls !== 'new') return row;
    const found = existing.get(row.serial);
    if (!found) return row;
    const cmp = compareWithExisting(row, found);
    return cmp.compatible
      ? {
          ...row,
          cls: 'existing',
          existing: found,
          reason: 'Already registered with matching data.',
        }
      : { ...row, cls: 'conflict', existing: found, reason: cmp.reason };
  });
}

export function countRows(rows: ClassifiedRow[]): ImportCounts {
  const c = {
    total: rows.length,
    valid: 0,
    new: 0,
    existing: 0,
    conflict: 0,
    duplicate: 0,
    invalid: 0,
  };
  for (const r of rows) c[r.cls]++;
  c.valid = c.total - c.invalid;
  return c;
}
