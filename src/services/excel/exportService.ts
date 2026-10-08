import { getDb } from '../firebase/firestore';
import { AppError, toAppError } from '../errors';
import { buildExportDataset } from './exportDataset';
import { fetchAllCompanies, fetchAllSerials } from './exportData';
import { buildWorkbook, XLSX_MIME } from './exportWorkbook';

import { logError } from '../../utils/log';
export type ExportPhase = 'preparing' | 'generating';

export interface ExportResult {
  blob: Blob;
  filename: string;
  recordCount: number;
}

/** serial-label-export-YYYY-MM-DD.xlsx, using the exporting admin's local calendar date. */
export function exportFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `serial-label-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.xlsx`;
}

/**
 * Admin export: read the complete serials collection from Firestore (+ companies for names and
 * code types), then build the workbook. Authorization is enforced by the Firestore rules; a
 * non-admin's read fails with permission-denied. Nothing is stored; the caller downloads the blob.
 */
export async function exportSerialsToExcel(opts: {
  exportedBy: string;
  onPhase?: (phase: ExportPhase) => void;
  onProgress?: (serialsRead: number) => void;
}): Promise<ExportResult> {
  opts.onPhase?.('preparing');
  let serials, companies;
  try {
    const db = getDb();
    [serials, companies] = await Promise.all([
      fetchAllSerials(db, opts.onProgress),
      fetchAllCompanies(db),
    ]);
  } catch (e) {
    const err = toAppError(e, 'Unable to read serial data. Please try again.');
    throw err.code === 'permission-denied'
      ? new AppError('permission-denied', 'You do not have permission to export serial data.', {
          cause: e,
        })
      : err;
  }

  opts.onPhase?.('generating');
  const now = new Date();
  try {
    const dataset = buildExportDataset({
      serials,
      companies,
      exportedAt: now,
      exportedBy: opts.exportedBy,
    });
    const bytes = await buildWorkbook(dataset);
    return {
      blob: new Blob([bytes], { type: XLSX_MIME }),
      filename: exportFilename(now),
      recordCount: dataset.summary.total,
    };
  } catch (e) {
    logError('Excel generation failed', e);
    throw new AppError('unknown', 'Unable to generate the Excel file. Please try again.', {
      cause: e,
    });
  }
}
