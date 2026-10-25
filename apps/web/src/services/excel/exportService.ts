import { getDb } from '../firebase/firestore';
import { AppError, toAppError } from '../errors';
import { buildExportDataset } from './exportDataset';
import { exportFilename } from './exportFilename';
import { fetchAllCompanies, fetchAllSerials } from './exportData';
import { buildWorkbook, XLSX_MIME } from './exportWorkbook';

import { logError } from '../../utils/log';
import { msg } from '../../i18n/core';
export type ExportPhase = 'preparing' | 'generating';

export interface ExportResult {
  blob: Blob;
  filename: string;
  recordCount: number;
}

export { exportFilename } from './exportFilename';

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
    const err = toAppError(e, msg('export.readFailed'));
    throw err.code === 'permission-denied'
      ? new AppError('permission-denied', msg('export.noPermission'), {
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
    throw new AppError('unknown', msg('export.generateFailed'), {
      cause: e,
    });
  }
}
