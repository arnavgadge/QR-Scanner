import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { dataService } from '../../data';
import { useI18n } from '../../hooks/useI18n';
import { recordedBy } from '../stations/recordedBy';
import type { RecentScansController } from '../../hooks/useRecentScans';
import type { ScanLog } from '../../types';

function ResultBadge({ result }: { result: ScanLog['result'] }) {
  const { t } = useI18n();
  return result === 'duplicate' ? (
    <span className="rounded bg-danger-soft px-2 py-0.5 text-sm font-bold text-danger">
      {t('common.badgeDuplicate')}
    </span>
  ) : (
    <span className="rounded bg-success-soft px-2 py-0.5 text-sm font-bold text-success">
      {t('common.badgeNew')}
    </span>
  );
}

/** Presentational: the owning page runs the (limited) query and can refresh it after a scan. */
export function RecentScans({ recent }: { recent: RecentScansController }) {
  const { state, reload } = recent;
  const { t, dateTime } = useI18n();
  const stations = dataService.capabilities.stations;

  return (
    <section aria-labelledby="recent-title" className="mt-10">
      <h2 id="recent-title" className="mb-3 text-xl font-bold">
        {t('nav.recentScans')}
      </h2>
      {state.status === 'loading' && <LoadingState label={t('recent.loading')} />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.scans.length === 0 && (
        <p className="text-ink-muted">{t('recent.empty')}</p>
      )}
      {state.status === 'ready' && state.scans.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
            <table className="w-full text-left">
              <thead className="bg-info-soft text-sm">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {t('common.time')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t('common.serial')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t('common.result')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {t('common.company')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {stations ? t('common.station') : t('common.operator')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.scans.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-3 py-2 whitespace-nowrap">{dateTime(s.timestamp)}</td>
                    <td className="px-3 py-2 font-mono">{s.serial}</td>
                    <td className="px-3 py-2">
                      <ResultBadge result={s.result} />
                    </td>
                    <td className="px-3 py-2">{s.company}</td>
                    <td className="px-3 py-2">{recordedBy(t, s.nodeName, s.scannedByName)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile list */}
          <ul className="space-y-2 md:hidden">
            {state.scans.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold break-all">{s.serial}</span>
                  <ResultBadge result={s.result} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {s.company} · {recordedBy(t, s.nodeName, s.scannedByName)}
                </p>
                <p className="text-sm text-ink-muted">{dateTime(s.timestamp)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
