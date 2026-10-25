import { Fragment, useState } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import type { ImportHistoryState } from '../../hooks/useImportHistory';
import { useI18n } from '../../hooks/useI18n';
import { dataService } from '../../data';
import { ImportDetails } from './ImportDetails';

interface Props {
  state: ImportHistoryState;
  onRetry: () => void;
}

/**
 * Past imports. Desktop server: a row opens the import's details (which serials were added, which
 * were skipped, and the conflicts).
 */
export function ImportHistoryList({ state, onRetry }: Props) {
  const { t, number, dateTime } = useI18n();
  const withDetails = dataService.capabilities.serialLookup;
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  return (
    <section aria-labelledby="history-title" className="mt-10">
      <h2 id="history-title" className="mb-3 text-xl font-bold">
        {t('importHistory.title')}
      </h2>
      {state.status === 'loading' && <LoadingState label={t('importHistory.loading')} />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={onRetry} />}
      {state.status === 'ready' && state.entries.length === 0 && (
        <p className="text-ink-muted">{t('importHistory.empty')}</p>
      )}
      {state.status === 'ready' && state.entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left">
            <thead className="bg-info-soft text-sm">
              <tr>
                {[
                  t('common.file'),
                  t('importHistory.date'),
                  t('importHistory.administrator'),
                  t('importHistory.total'),
                  t('common.new'),
                  t('import.skipped'),
                  t('import.conflicts'),
                  t('common.status'),
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.entries.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    className={`border-t border-line ${withDetails ? 'cursor-pointer hover:bg-info-soft' : ''}`}
                    onClick={withDetails ? () => toggle(e.id) : undefined}
                    data-testid="import-history-row"
                  >
                    <td className="px-3 py-2 break-all">
                      {withDetails ? (
                        <button
                          type="button"
                          className="text-left font-semibold underline"
                          aria-expanded={open === e.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            toggle(e.id);
                          }}
                        >
                          {e.filename}
                        </button>
                      ) : (
                        e.filename
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateTime(e.importedAt)}</td>
                    <td className="px-3 py-2">{e.importedByName}</td>
                    <td className="px-3 py-2">{number(e.totalRows)}</td>
                    <td className="px-3 py-2 font-semibold text-success">{number(e.newCount)}</td>
                    <td className="px-3 py-2">{number(e.skipped)}</td>
                    <td className="px-3 py-2">
                      {e.conflicts > 0 ? (
                        <span className="font-semibold text-danger">{number(e.conflicts)}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {e.status === 'completed' ? (
                        <span className="font-semibold text-success">
                          {t('importHistory.completed')}
                        </span>
                      ) : (
                        <span className="font-semibold text-danger" title={e.error}>
                          {t('importHistory.failed')}
                        </span>
                      )}
                    </td>
                  </tr>
                  {withDetails && open === e.id && (
                    <tr className="border-t border-line bg-surface-muted">
                      <td colSpan={8} className="px-3 py-3">
                        <ImportDetails importId={e.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
