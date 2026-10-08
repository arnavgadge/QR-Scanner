/** Excel boundary: admin export (Phase 5) and admin import / safe merge (Phase 4). */
export { exportSerialsToExcel, exportFilename } from './exportService';
export type { ExportPhase, ExportResult } from './exportService';
export { previewImportFile, confirmImportPreview } from './importService';
export { getImportHistory } from './importHistoryService';
export type {
  ClassifiedRow,
  ImportCounts,
  ImportOutcome,
  ImportPreview,
  RowClass,
} from './importTypes';
