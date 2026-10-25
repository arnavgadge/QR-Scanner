import { useCallback } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { dataService } from '../../data';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../i18n';
import type { ImportItem, ImportItemOutcome } from '../../types';

const GROUPS: { outcome: ImportItemOutcome; title: MessageKey; tone: string }[] = [
  { outcome: 'added', title: 'importDetails.added', tone: 'text-success' },
  { outcome: 'conflict', title: 'importDetails.conflicts', tone: 'text-danger' },
  { outcome: 'skipped', title: 'importDetails.skipped', tone: 'text-ink' },
  { outcome: 'duplicate', title: 'importDetails.duplicates', tone: 'text-ink' },
  { outcome: 'invalid', title: 'importDetails.invalid', tone: 'text-danger' },
];

/** What one Excel import did, row by row: added, conflicts, skipped, repeated and invalid rows. */
export function ImportDetails({ importId }: { importId: string }) {
  const { t, text, number } = useI18n();
  const loader = useCallback(() => dataService.getImportDetails(importId), [importId]);
  const details = useAsyncData(loader, 'importDetails.loadFailed');

  if (details.state.status === 'loading') return <LoadingState label={t('common.loading')} />;
  if (details.state.status === 'error') {
    return <ErrorNotice message={details.state.message} onRetry={details.reload} />;
  }
  const { recorded, items } = details.state.data;
  if (!recorded) {
    return (
      <p className="text-sm text-ink-muted" data-testid="import-details-none">
        {t('importDetails.notRecorded')}
      </p>
    );
  }
  const reason = (it: ImportItem) => (it.reasonMsg ? text(it.reasonMsg) : it.reason);
  return (
    <div className="space-y-4" data-testid="import-details">
      {GROUPS.map(({ outcome, title, tone }) => {
        const rows = items.filter((it) => it.outcome === outcome);
        if (rows.length === 0) return null;
        return (
          <section key={outcome} data-testid={`import-details-${outcome}`}>
            <h3 className={`text-sm font-extrabold tracking-wide uppercase ${tone}`}>
              {t(title)} ({number(rows.length)})
            </h3>
            <div className="mt-1 max-h-72 overflow-auto rounded-md border border-line">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-info-soft">
                  <tr>
                    {[
                      t('importDetails.row'),
                      t('common.serial'),
                      t('common.company'),
                      t('common.partNumber'),
                      ...(outcome === 'added' ? [] : [t('importDetails.reason')]),
                    ].map((h) => (
                      <th key={h} scope="col" className="px-2 py-1">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it, i) => (
                    <tr key={`${it.sheet}|${it.rowNumber}|${i}`} className="border-t border-line">
                      <td className="px-2 py-1 whitespace-nowrap">
                        {it.sheet
                          ? t('importDetails.sheetRow', { sheet: it.sheet, row: it.rowNumber })
                          : number(it.rowNumber)}
                      </td>
                      <td className="px-2 py-1 font-mono break-all">{it.serial || '—'}</td>
                      <td className="px-2 py-1">{it.companyName || '—'}</td>
                      <td className="px-2 py-1">{it.partNo || '—'}</td>
                      {outcome !== 'added' && <td className="px-2 py-1">{reason(it) || '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
