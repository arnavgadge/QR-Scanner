import { useCallback } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { useAsyncData } from '../../hooks/useAsyncData';
import { getExportHistory } from '../../services/admin/exportHistoryService';
import { formatDateTime } from '../../utils/format';

/** Audit trail of Excel exports: file, who, when, how many records. */
export function ExportHistoryList({ refreshKey = 0 }: { refreshKey?: number }) {
  const loader = useCallback(() => (void refreshKey, getExportHistory(50)), [refreshKey]);
  const { state, reload } = useAsyncData(loader, 'Unable to load export history.');
  return (
    <div data-testid="export-history">
      {state.status === 'loading' && <LoadingState label="Loading export history…" />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-ink-muted" data-testid="export-history-empty">
          No exports yet.
        </p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="bg-info-soft text-sm">
              <tr>
                {['File', 'Exported at', 'Exported by', 'Records'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.map((e) => (
                <tr key={e.id} className="border-t border-line" data-testid="export-row">
                  <td className="px-3 py-2 break-all">{e.filename}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(e.exportedAt)}</td>
                  <td className="px-3 py-2">{e.exportedByName}</td>
                  <td className="px-3 py-2">{e.recordCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
