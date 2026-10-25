import { useCallback } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { useAsyncData } from '../../hooks/useAsyncData';
import { dataService } from '../../data';
import { useI18n } from '../../hooks/useI18n';

/** Audit trail of Excel exports: file, who, when, how many records. */
export function ExportHistoryList({ refreshKey = 0 }: { refreshKey?: number }) {
  const loader = useCallback(
    () => (void refreshKey, dataService.getExportHistory(50)),
    [refreshKey],
  );
  const { state, reload } = useAsyncData(loader, 'exportHistory.loadFailed');
  const { t, number, dateTime } = useI18n();
  return (
    <div data-testid="export-history">
      {state.status === 'loading' && <LoadingState label={t('exportHistory.loading')} />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-ink-muted" data-testid="export-history-empty">
          {t('exportHistory.empty')}
        </p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="bg-info-soft text-sm">
              <tr>
                {[
                  t('common.file'),
                  t('exportHistory.exportedAt'),
                  t('exportHistory.exportedBy'),
                  t('exportHistory.records'),
                ].map((h) => (
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
                  <td className="px-3 py-2 whitespace-nowrap">{dateTime(e.exportedAt)}</td>
                  <td className="px-3 py-2">{e.exportedByName}</td>
                  <td className="px-3 py-2">{number(e.recordCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
