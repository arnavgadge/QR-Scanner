import type { CodeType, Company } from '../../types';

/**
 * Pure transformation: Firestore serials + companies -> the rows and summary of the export.
 * No Firestore, no Excel here, so it is unit-testable.
 */

/** A serial as read from Firestore, tolerant of incomplete documents. */
export interface ExportSerial {
  /** The Firestore document ID (authoritative). */
  serial: string;
  partNo: string;
  /** Company display name stored on the serial document. */
  company: string;
  companyId: string;
  /** Stored value, preserved as-is (excel | manual | scan). */
  source: string;
  scannedAt: Date | null;
  scannedByName: string;
  /** True if required fields were missing/malformed in the stored document. */
  incomplete: boolean;
}

export interface ExportRow {
  serial: string;
  partNo: string;
  company: string;
  companyId: string;
  /** BARCODE | QR | NOT CONFIGURED (company has no valid code type) | UNKNOWN (company record not found). */
  codeType: string;
  source: string;
  registeredAt: Date | null;
  registeredBy: string;
}

export interface CountEntry {
  label: string;
  count: number;
}

export interface CompanyCount {
  company: string;
  companyId: string;
  codeType: string;
  count: number;
}

export interface ExportSummary {
  exportedAt: Date;
  exportedBy: string;
  total: number;
  byCompany: CompanyCount[];
  bySource: CountEntry[];
  byCodeType: CountEntry[];
  earliest: Date | null;
  latest: Date | null;
  incomplete: number;
  unresolvedCompany: number;
}

export interface ExportDataset {
  rows: ExportRow[];
  summary: ExportSummary;
}

export const SORT_DESCRIPTION = 'Company name (A-Z), then Serial Number (A-Z)';

const CODE_TYPE_LABEL: Record<CodeType, string> = { barcode: 'BARCODE', qr: 'QR' };
const SOURCE_ORDER = ['excel', 'manual', 'scan'];

/** Plain code-point comparison: identical result on every machine/locale. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildExportDataset(input: {
  serials: ExportSerial[];
  companies: Company[];
  exportedAt: Date;
  exportedBy: string;
}): ExportDataset {
  const byId = new Map(input.companies.map((c) => [c.id, c]));
  let unresolvedCompany = 0;

  const rows: ExportRow[] = input.serials.map((s) => {
    const c = byId.get(s.companyId);
    if (!c) unresolvedCompany++;
    return {
      serial: s.serial,
      partNo: s.partNo,
      // Human-readable: current company name, falling back to the name stored on the serial.
      company: c ? c.name : s.company,
      companyId: s.companyId,
      codeType: c ? (c.codeType ? CODE_TYPE_LABEL[c.codeType] : 'NOT CONFIGURED') : 'UNKNOWN',
      source: s.source,
      registeredAt: s.scannedAt,
      registeredBy: s.scannedByName,
    };
  });

  rows.sort(
    (a, b) =>
      cmp(a.company.toLowerCase(), b.company.toLowerCase()) ||
      cmp(a.companyId, b.companyId) ||
      cmp(a.serial, b.serial),
  );

  const companyCounts = new Map<string, CompanyCount>();
  const sourceCounts = new Map<string, number>();
  const codeCounts = new Map<string, number>();
  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const r of rows) {
    const key = r.companyId + '\u0000' + r.company;
    const cc = companyCounts.get(key) ?? {
      company: r.company,
      companyId: r.companyId,
      codeType: r.codeType,
      count: 0,
    };
    cc.count++;
    companyCounts.set(key, cc);
    sourceCounts.set(r.source, (sourceCounts.get(r.source) ?? 0) + 1);
    codeCounts.set(r.codeType, (codeCounts.get(r.codeType) ?? 0) + 1);
    if (r.registeredAt) {
      if (!earliest || r.registeredAt < earliest) earliest = r.registeredAt;
      if (!latest || r.registeredAt > latest) latest = r.registeredAt;
    }
  }

  const bySource: CountEntry[] = [...sourceCounts.entries()]
    .sort(
      ([a], [b]) =>
        (SOURCE_ORDER.indexOf(a) + 1 || 99) - (SOURCE_ORDER.indexOf(b) + 1 || 99) || cmp(a, b),
    )
    .map(([label, count]) => ({ label, count }));

  return {
    rows,
    summary: {
      exportedAt: input.exportedAt,
      exportedBy: input.exportedBy,
      total: rows.length,
      byCompany: [...companyCounts.values()].sort(
        (a, b) =>
          cmp(a.company.toLowerCase(), b.company.toLowerCase()) || cmp(a.companyId, b.companyId),
      ),
      bySource,
      byCodeType: [...codeCounts.entries()]
        .sort(([a], [b]) => cmp(a, b))
        .map(([label, count]) => ({ label, count })),
      earliest,
      latest,
      incomplete: input.serials.filter((s) => s.incomplete).length,
      unresolvedCompany,
    },
  };
}
