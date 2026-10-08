import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import type { ImportHistoryState } from '../../hooks/useImportHistory';
import { formatDateTime } from '../../utils/format';

interface Props {
  state: ImportHistoryState;
  onRetry: () => void;
}

export function ImportHistoryList({ state, onRetry }: Props) {
  return (
    <section aria-labelledby="history-title" className="mt-10">
      <h2 id="history-title" className="mb-3 text-xl font-bold">
        Import history
      </h2>
      {state.status === 'loading' && <LoadingState label="Loading import history…" />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={onRetry} />}
      {state.status === 'ready' && state.entries.length === 0 && (
        <p className="text-ink-muted">No imports yet.</p>
      )}
      {state.status === 'ready' && state.entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="bg-info-soft text-sm">
              <tr>
                {[
                  'File',
                  'Date',
                  'Administrator',
                  'Total',
                  'New',
                  'Skipped',
                  'Conflicts',
                  'Status',
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.entries.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-3 py-2 break-all">{e.filename}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(e.importedAt)}</td>
                  <td className="px-3 py-2">{e.importedByName}</td>
                  <td className="px-3 py-2">{e.totalRows.toLocaleString()}</td>
                  <td className="px-3 py-2 font-semibold text-success">
                    {e.newCount.toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{e.skipped.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {e.conflicts > 0 ? (
                      <span className="font-semibold text-danger">
                        {e.conflicts.toLocaleString()}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e.status === 'completed' ? (
                      <span className="font-semibold text-success">Completed</span>
                    ) : (
                      <span className="font-semibold text-danger" title={e.error}>
                        Failed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
