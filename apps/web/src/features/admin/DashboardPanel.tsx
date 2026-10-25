import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey } from '../../i18n';
import { dataService } from '../../data';
import { localDayRange, timeZoneName } from '../../services/admin/dateRanges';
import { codeTypeKey } from '../companies/codeTypeLabel';
import { recordedBy } from '../stations/recordedBy';

/** One metric = one independent Firestore count. If it fails it says so; it never shows a guess. */
function MetricCard({
  label,
  hint,
  testId,
  loader,
  render,
  tone = '',
}: {
  label: MessageKey;
  hint?: MessageKey;
  testId: string;
  loader: () => Promise<number>;
  render?: (n: number) => ReactNode;
  tone?: string;
}) {
  const { state, reload } = useAsyncData(loader, 'dashboard.metricFailed');
  const { t, number } = useI18n();
  return (
    <div className="rounded-lg border border-line bg-surface p-4" data-testid={testId}>
      <p className="text-sm font-semibold text-ink-muted">{t(label)}</p>
      {state.status === 'loading' && (
        <p className="mt-1 text-lg text-ink-muted" role="status">
          {t('common.loading')}
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-1">
          <p className="font-semibold text-danger" data-testid={`${testId}-unavailable`}>
            {t('common.unavailable')}
          </p>
          <button type="button" onClick={reload} className="text-sm underline">
            {t('common.retry')}
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <p className={`mt-1 text-3xl font-extrabold ${tone}`} data-testid={`${testId}-value`}>
          {render ? render(state.data) : number(state.data)}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-ink-muted">{t(hint)}</p>}
    </div>
  );
}

function CompanySummary({ refreshKey }: { refreshKey: number }) {
  const loader = useCallback(async () => {
    void refreshKey;
    const companies = await dataService.getAllCompanies();
    const counts = await Promise.allSettled(
      companies.map((c) => dataService.counts.serialsForCompany(c.id)),
    );
    return companies.map((c, i) => {
      const r = counts[i]!;
      return { company: c, serials: r.status === 'fulfilled' ? r.value : null };
    });
  }, [refreshKey]);
  const { state, reload } = useAsyncData(loader, 'companies.loadAllFailed');
  const { t, number } = useI18n();
  return (
    <section aria-labelledby="co-title" data-testid="company-summary">
      <h2 id="co-title" className="mb-2 text-lg font-bold">
        {t('dashboard.companies')}
      </h2>
      {state.status === 'loading' && <LoadingState label={t('companies.loading')} />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-ink-muted">{t('dashboard.noCompanies')}</p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-info-soft">
              <tr>
                {[
                  t('common.company'),
                  t('common.status'),
                  t('dashboard.label'),
                  t('dashboard.registeredSerials'),
                ].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.map(({ company: c, serials }) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold">{c.name}</td>
                  <td className="px-3 py-2">
                    {c.active ? t('common.active') : t('common.inactive')}
                  </td>
                  <td className="px-3 py-2">{t(codeTypeKey(c.codeType))}</td>
                  <td className="px-3 py-2" data-testid={`company-serials-${c.id}`}>
                    {serials === null ? t('common.unavailable') : number(serials)}
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

function RecentList<T extends { id: string }>({
  title,
  failed,
  testId,
  loader,
  empty,
  row,
}: {
  title: MessageKey;
  failed: MessageKey;
  testId: string;
  loader: () => Promise<T[]>;
  empty: MessageKey;
  row: (item: T) => ReactNode;
}) {
  const { state, reload } = useAsyncData(loader, failed);
  const { t } = useI18n();
  return (
    <section aria-label={t(title)} data-testid={testId}>
      <h3 className="mb-2 font-bold">{t(title)}</h3>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-ink-muted">{t(empty)}</p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {state.data.map((item) => (
            <li key={item.id} className="px-3 py-2">
              {row(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Admin dashboard: real counts and limited recent activity from Firestore. */
export function DashboardPanel() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { t, dateTime } = useI18n();
  // "Today" = the admin's LOCAL calendar day (same zone the UI shows times in).
  const day = useMemo(() => {
    void refreshKey;
    return localDayRange();
  }, [refreshKey]);
  const tz = timeZoneName();

  const total = useCallback(() => (void refreshKey, dataService.counts.serials()), [refreshKey]);
  const today = useCallback(
    () => dataService.counts.serialsRegisteredBetween(day.start, day.end),
    [day],
  );
  const dups = useCallback(
    () => dataService.counts.duplicateAttemptsBetween(day.start, day.end),
    [day],
  );
  const companiesTotal = useCallback(
    () => (void refreshKey, dataService.counts.companies()),
    [refreshKey],
  );
  const operators = useCallback(
    () => (void refreshKey, dataService.counts.activeOperators()),
    [refreshKey],
  );
  const activeCompanies = useCallback(
    () => (void refreshKey, dataService.counts.activeCompanies()),
    [refreshKey],
  );
  const recentScans = useCallback(
    async () => (void refreshKey, (await dataService.getRecentScans(10)).map((s) => ({ ...s }))),
    [refreshKey],
  );
  const recentImports = useCallback(
    () => (void refreshKey, dataService.getImportHistory(5)),
    [refreshKey],
  );
  const recentExports = useCallback(
    () => (void refreshKey, dataService.getExportHistory(5)),
    [refreshKey],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{t('dashboard.todayNote', { tz })}</p>
        <Button variant="secondary" onClick={() => setRefreshKey((n) => n + 1)}>
          {t('common.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="dashboard.total"
          testId="metric-total"
          loader={total}
          tone="text-action"
          hint="dashboard.totalHint"
        />
        <MetricCard
          label="dashboard.today"
          testId="metric-today"
          loader={today}
          tone="text-success"
          hint="dashboard.todayHint"
        />
        <MetricCard
          label="dashboard.dups"
          testId="metric-dups"
          loader={dups}
          tone="text-danger"
          hint="dashboard.dupsHint"
        />
        <MetricCard
          label="dashboard.companies"
          testId="metric-companies"
          loader={companiesTotal}
          hint="dashboard.companiesHint"
        />
        <MetricCard
          label="dashboard.operators"
          testId="metric-operators"
          loader={operators}
          hint="dashboard.operatorsHint"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="dashboard.activeCompanies"
          testId="metric-active-companies"
          loader={activeCompanies}
        />
      </div>

      <CompanySummary refreshKey={refreshKey} />

      <section aria-labelledby="activity-title" className="space-y-3">
        <h2 id="activity-title" className="text-lg font-bold">
          {t('dashboard.activity')}
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <RecentList
            title="dashboard.recentScans"
            failed="dashboard.recentScansFailed"
            testId="recent-scans"
            loader={recentScans}
            empty="dashboard.noScans"
            row={(s) => (
              <>
                <span className="font-mono font-semibold">{s.serial}</span>{' '}
                <span
                  className={
                    s.result === 'duplicate' ? 'font-bold text-danger' : 'font-bold text-success'
                  }
                >
                  {s.result === 'duplicate' ? t('common.badgeDuplicate') : t('common.badgeNew')}
                </span>
                <span className="block text-ink-muted">
                  {s.company} · {recordedBy(t, s.nodeName, s.scannedByName)} ·{' '}
                  {dateTime(s.timestamp)}
                </span>
              </>
            )}
          />
          <RecentList
            title="dashboard.recentImports"
            failed="dashboard.recentImportsFailed"
            testId="recent-imports"
            loader={recentImports}
            empty="dashboard.noImports"
            row={(e) => (
              <>
                <span className="font-semibold break-all">{e.filename}</span>
                <span className="block text-ink-muted">
                  {t('dashboard.importSummary', {
                    created: e.newCount,
                    skipped: e.skipped,
                    conflicts: e.conflicts,
                  })}{' '}
                  · {e.importedByName} · {dateTime(e.importedAt)}
                </span>
              </>
            )}
          />
          <RecentList
            title="dashboard.recentExports"
            failed="dashboard.recentExportsFailed"
            testId="recent-exports"
            loader={recentExports}
            empty="dashboard.noExports"
            row={(e) => (
              <>
                <span className="font-semibold break-all">{e.filename}</span>
                <span className="block text-ink-muted">
                  {t('dashboard.exportRecords', { count: e.recordCount })} · {e.exportedByName} ·{' '}
                  {dateTime(e.exportedAt)}
                </span>
              </>
            )}
          />
        </div>
      </section>
    </div>
  );
}
