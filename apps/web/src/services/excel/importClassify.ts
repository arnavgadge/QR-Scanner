import { enText, msg, type Msg } from '../../i18n/core';
import { normalizeSerial } from '../../utils/serial';
import type { Company } from '../../types';
import { MAX_PART_LENGTH, serialValueProblem } from '../serial/serialValidation';
import type { ClassifiedRow, ExistingSerialInfo, ImportCounts, RawImportRow } from './importTypes';

export type CompanyResolution =
  { ok: true; company: Company } | { ok: false; reason: string; reasonMsg: Msg };

/** English `reason` plus the translatable `reasonMsg`. */
const because = (m: Msg) => ({ reason: enText(m), reasonMsg: m });

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
    if (found.length === 0)
      return { ok: false, ...because(msg('import.unknownCompanyId', { id: idCell })) };
    if (nameCell) {
      const named = byNameOrId(nameCell);
      if (named.length > 0 && !named.some((c) => c.id === found[0]?.id)) {
        return {
          ok: false,
          ...because(msg('import.companyIdMismatch', { name: nameCell, id: idCell })),
        };
      }
    }
  } else if (nameCell) {
    found = byNameOrId(nameCell);
    if (found.length === 0) {
      return { ok: false, ...because(msg('import.unknownCompany', { name: nameCell })) };
    }
    if (found.length > 1) {
      return { ok: false, ...because(msg('import.ambiguousCompany', { name: nameCell })) };
    }
  } else {
    return { ok: false, ...because(msg('import.companyMissing')) };
  }
  const company = found[0] as Company;
  if (!company.active) {
    return { ok: false, ...because(msg('import.companyInactive', { name: company.name })) };
  }
  return { ok: true, company };
}

/**
 * Same rule at preview time and at write time. A blank part number in the file makes no claim
 * and never conflicts; otherwise company and part number must match the stored record.
 */
export function compareWithExisting(
  row: { companyId: string; companyName: string; partNo: string },
  existing: ExistingSerialInfo,
): { compatible: true } | { compatible: false; reason: string; reasonMsg: Msg } {
  const reasons: Msg[] = [];
  if (row.companyId !== existing.companyId) {
    reasons.push(msg('import.companyDiffers', { file: row.companyName, stored: existing.company }));
  }
  if (row.partNo !== '' && row.partNo !== existing.partNo) {
    reasons.push(
      msg('import.partDiffers', {
        file: row.partNo,
        stored: existing.partNo || msg('common.blank'),
      }),
    );
  }
  const [first, second] = reasons;
  if (!first) return { compatible: true };
  return {
    compatible: false,
    ...because(second ? msg('import.bothDiffer', { first, second }) : first),
  };
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
/**
 * What makes two rows "the same serial". Default: the serial alone (the web app: a serial is unique
 * across all companies). The desktop server passes `companySerialKey` (unique per company).
 */
export type RowKey = (row: { serial: string; companyId: string }) => string;
export const serialKey: RowKey = (row) => row.serial;
export const companySerialKey: RowKey = (row) => `${row.companyId}\u0000${row.serial}`;

export function normalizeRows(
  raw: RawImportRow[],
  companies: Company[],
  key: RowKey = serialKey,
): NormalizedImport {
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
    const invalid = (reason: Msg): ClassifiedRow => ({
      ...base,
      cls: 'invalid',
      ...because(reason),
    });

    if (r.problems.length > 0) {
      // Cell problems from the parser carry translatable versions; hand-built rows may not.
      rows.push(
        r.problemMsgs?.length === r.problems.length
          ? invalid(msg('common.joined', { items: r.problemMsgs }))
          : { ...base, cls: 'invalid', reason: r.problems.join(' ') },
      );
      continue;
    }
    if (!serial) {
      rows.push(invalid(msg('import.serialMissing')));
      continue;
    }
    // The same value rules as manual entry / OCR (length, storable as a document ID).
    const valueProblem = serialValueProblem(serial);
    if (valueProblem) {
      rows.push(invalid(valueProblem.msg));
      continue;
    }
    if (partNo.length > MAX_PART_LENGTH) {
      rows.push(invalid(msg('import.partTooLong', { max: MAX_PART_LENGTH })));
      continue;
    }
    const resolved = resolveCompany(companies, r.companyId.trim(), r.company.trim());
    if (!resolved.ok) {
      rows.push(invalid(resolved.reasonMsg));
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

    const earlier = firstRowOf.get(key(row));
    if (earlier !== undefined) {
      // Row numbers are identifiers, so they are passed as text (never digit-grouped).
      const earlierRow = String(earlier.row);
      rows.push({
        ...row,
        cls: 'duplicate',
        duplicateOfRow: earlier.row,
        ...because(
          earlier.sheet !== (r.sheet ?? '')
            ? msg('import.sameAsRowOnSheet', { row: earlierRow, sheet: earlier.sheet })
            : msg('import.sameAsRow', { row: earlierRow }),
        ),
      });
      continue;
    }
    firstRowOf.set(key(row), { row: r.rowNumber, sheet: r.sheet ?? '' });
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
  /** Must match the key used by normalizeRows; `existing` is keyed the same way. */
  key: RowKey = serialKey,
): ClassifiedRow[] {
  return normalized.rows.map((row) => {
    if (row.cls !== 'new') return row;
    const found = existing.get(key(row));
    if (!found) return row;
    const cmp = compareWithExisting(row, found);
    return cmp.compatible
      ? {
          ...row,
          cls: 'existing',
          existing: found,
          ...because(msg('import.alreadyRegistered')),
        }
      : { ...row, cls: 'conflict', existing: found, reason: cmp.reason, reasonMsg: cmp.reasonMsg };
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
