import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import {
  countActiveCompanies,
  countActiveOperators,
  countCompanies,
  countDuplicateAttemptsBetween,
  countSerials,
  countSerialsForCompany,
  countSerialsRegisteredBetween,
} from '../../services/admin/dashboardService';
import { localDayRange, timeZoneName } from '../../services/admin/dateRanges';
import { getExportHistory } from '../../services/admin/exportHistoryService';
import { getAllCompanies } from '../../services/companies/companyAdminService';
import { getImportHistory } from '../../services/excel';
import { getRecentScans } from '../../services/scans/scanLogService';
import { formatDateTime } from '../../utils/format';
import { codeTypeLabel } from '../companies/codeTypeLabel';

/** One metric = one independent Firestore count. If it fails it says so; it never shows a guess. */
function MetricCard({
  label,
  hint,
  testId,
  loader,
  render,
  tone = '',
}: {
  label: string;
  hint?: string;
  testId: string;
  loader: () => Promise<number>;
  render?: (n: number) => ReactNode;
  tone?: string;
}) {
  const { state, reload } = useAsyncData(loader, 'Unavailable');
  return (
    <div className="rounded-lg border border-line bg-surface p-4" data-testid={testId}>
      <p className="text-sm font-semibold text-ink-muted">{label}</p>
      {state.status === 'loading' && (
        <p className="mt-1 text-lg text-ink-muted" role="status">
          Loading…
        </p>
      )}
      {state.status === 'error' && (
        <div className="mt-1">
          <p className="font-semibold text-danger" data-testid={`${testId}-unavailable`}>
            Unavailable
          </p>
          <button type="button" onClick={reload} className="text-sm underline">
            Retry
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <p className={`mt-1 text-3xl font-extrabold ${tone}`} data-testid={`${testId}-value`}>
          {render ? render(state.data) : state.data.toLocaleString()}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

function CompanySummary({ refreshKey }: { refreshKey: number }) {
  const loader = useCallback(async () => {
    void refreshKey;
    const companies = await getAllCompanies();
    const counts = await Promise.allSettled(companies.map((c) => countSerialsForCompany(c.id)));
    return companies.map((c, i) => {
      const r = counts[i]!;
      return { company: c, serials: r.status === 'fulfilled' ? r.value : null };
    });
  }, [refreshKey]);
  const { state, reload } = useAsyncData(loader, 'Unable to load companies.');
  return (
    <section aria-labelledby="co-title" data-testid="company-summary">
      <h2 id="co-title" className="mb-2 text-lg font-bold">
        Companies
      </h2>
      {state.status === 'loading' && <LoadingState label="Loading companies…" />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-ink-muted">No companies yet. Add one on the Companies page.</p>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-info-soft">
              <tr>
                {['Company', 'Status', 'Label', 'Registered serials'].map((h) => (
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
                  <td className="px-3 py-2">{c.active ? 'Active' : 'Inactive'}</td>
                  <td className="px-3 py-2">{codeTypeLabel(c.codeType)}</td>
                  <td className="px-3 py-2" data-testid={`company-serials-${c.id}`}>
                    {serials === null ? 'Unavailable' : serials.toLocaleString()}
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
  testId,
  loader,
  empty,
  row,
}: {
  title: string;
  testId: string;
  loader: () => Promise<T[]>;
  empty: string;
  row: (item: T) => ReactNode;
}) {
  const { state, reload } = useAsyncData(loader, `Unable to load ${title.toLowerCase()}.`);
  return (
    <section aria-label={title} data-testid={testId}>
      <h3 className="mb-2 font-bold">{title}</h3>
      {state.status === 'loading' && <LoadingState label="Loading…" />}
      {state.status === 'error' && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <p className="text-ink-muted">{empty}</p>
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
  // "Today" = the admin's LOCAL calendar day (same zone the UI shows times in).
  const day = useMemo(() => {
    void refreshKey;
    return localDayRange();
  }, [refreshKey]);
  const tz = timeZoneName();

  const total = useCallback(() => (void refreshKey, countSerials()), [refreshKey]);
  const today = useCallback(() => countSerialsRegisteredBetween(day.start, day.end), [day]);
  const dups = useCallback(() => countDuplicateAttemptsBetween(day.start, day.end), [day]);
  const companiesTotal = useCallback(() => (void refreshKey, countCompanies()), [refreshKey]);
  const operators = useCallback(() => (void refreshKey, countActiveOperators()), [refreshKey]);
  const activeCompanies = useCallback(
    () => (void refreshKey, countActiveCompanies()),
    [refreshKey],
  );
  const recentScans = useCallback(
    async () => (void refreshKey, (await getRecentScans(10)).map((s) => ({ ...s }))),
    [refreshKey],
  );
  const recentImports = useCallback(() => (void refreshKey, getImportHistory(5)), [refreshKey]);
  const recentExports = useCallback(() => (void refreshKey, getExportHistory(5)), [refreshKey]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          &ldquo;Today&rdquo; means your local calendar day ({tz}). Counts come straight from
          Firestore.
        </p>
        <Button variant="secondary" onClick={() => setRefreshKey((n) => n + 1)}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Total registered serials"
          testId="metric-total"
          loader={total}
          tone="text-action"
          hint="One serial record = one registered serial (scan attempts are not counted)."
        />
        <MetricCard
          label="Serials registered today"
          testId="metric-today"
          loader={today}
          tone="text-success"
          hint="All sources, imports included."
        />
        <MetricCard
          label="Duplicate attempts today"
          testId="metric-dups"
          loader={dups}
          tone="text-danger"
          hint="Scan attempts, not unique serials."
        />
        <MetricCard
          label="Companies"
          testId="metric-companies"
          loader={companiesTotal}
          hint="Total, including inactive."
        />
        <MetricCard
          label="Active operators"
          testId="metric-operators"
          loader={operators}
          hint="Active operator accounts (not online status)."
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Active companies"
          testId="metric-active-companies"
          loader={activeCompanies}
        />
      </div>

      <CompanySummary refreshKey={refreshKey} />

      <section aria-labelledby="activity-title" className="space-y-3">
        <h2 id="activity-title" className="text-lg font-bold">
          Recent activity
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <RecentList
            title="Recent scans"
            testId="recent-scans"
            loader={recentScans}
            empty="No scan history yet."
            row={(s) => (
              <>
                <span className="font-mono font-semibold">{s.serial}</span>{' '}
                <span
                  className={
                    s.result === 'duplicate' ? 'font-bold text-danger' : 'font-bold text-success'
                  }
                >
                  {s.result === 'duplicate' ? 'DUPLICATE' : 'NEW'}
                </span>
                <span className="block text-ink-muted">
                  {s.company} · {s.scannedByName} · {formatDateTime(s.timestamp)}
                </span>
              </>
            )}
          />
          <RecentList
            title="Recent imports"
            testId="recent-imports"
            loader={recentImports}
            empty="No imports yet."
            row={(e) => (
              <>
                <span className="font-semibold break-all">{e.filename}</span>
                <span className="block text-ink-muted">
                  {e.newCount} new · {e.skipped} skipped · {e.conflicts} conflicts ·{' '}
                  {e.importedByName} · {formatDateTime(e.importedAt)}
                </span>
              </>
            )}
          />
          <RecentList
            title="Recent exports"
            testId="recent-exports"
            loader={recentExports}
            empty="No exports yet."
            row={(e) => (
              <>
                <span className="font-semibold break-all">{e.filename}</span>
                <span className="block text-ink-muted">
                  {e.recordCount.toLocaleString()} records · {e.exportedByName} ·{' '}
                  {formatDateTime(e.exportedAt)}
                </span>
              </>
            )}
          />
        </div>
      </section>
    </div>
  );
}
