import { useCallback, useMemo, useState } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import { inclusiveRange, timeZoneName } from '../../services/admin/dateRanges';
import type { ScanHistoryFilters } from '../../services/admin/scanHistoryService';
import { getAllCompanies } from '../../services/companies/companyAdminService';
import { getAllUsers } from '../../services/users/userAdminService';
import type { ScanLog, ScanResult } from '../../types';
import { formatDateTime } from '../../utils/format';
import { useScanHistory } from './useScanHistory';

interface Form {
  result: '' | ScanResult;
  companyId: string;
  source: '' | 'manual' | 'scan';
  scannedBy: string;
  from: string;
  to: string;
}
const EMPTY: Form = { result: '', companyId: '', source: '', scannedBy: '', from: '', to: '' };

const SOURCE_LABEL = { manual: 'Manual', scan: 'Photo (OCR)', excel: 'Excel' } as const;

function ResultBadge({ result }: { result: ScanLog['result'] }) {
  return result === 'duplicate' ? (
    <span className="rounded bg-danger-soft px-2 py-0.5 text-sm font-bold text-danger">
      DUPLICATE
    </span>
  ) : (
    <span className="rounded bg-success-soft px-2 py-0.5 text-sm font-bold text-success">NEW</span>
  );
}

const selectClass = 'mt-1 min-h-touch w-full rounded-md border border-line bg-surface px-2';

/**
 * Admin scan history: every scan ATTEMPT (scan_log), newest first, with filters and "load more"
 * pagination. This is not the import history and not the list of registered serials.
 */
export function ScanHistoryPanel() {
  const [form, setForm] = useState<Form>(EMPTY);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const companiesLoader = useCallback(() => getAllCompanies(), []);
  const usersLoader = useCallback(() => getAllUsers(), []);
  const companies = useAsyncData(companiesLoader, 'Unable to load companies.');
  const users = useAsyncData(usersLoader, 'Unable to load users.');

  const rangeProblem =
    form.from && form.to && form.from > form.to ? 'The start date is after the end date.' : null;

  const filters = useMemo<ScanHistoryFilters>(() => {
    const range = rangeProblem ? {} : inclusiveRange(form.from, form.to);
    return {
      ...(form.result ? { result: form.result } : {}),
      ...(form.companyId ? { companyId: form.companyId } : {}),
      ...(form.source ? { source: form.source } : {}),
      ...(form.scannedBy ? { scannedBy: form.scannedBy } : {}),
      ...range,
    };
  }, [form, rangeProblem]);
  const filtersKey = JSON.stringify([form, rangeProblem]);
  const history = useScanHistory(filters, filtersKey, !rangeProblem);
  const filtered = JSON.stringify(form) !== JSON.stringify(EMPTY);

  const state = history.state;
  const parts = state.status === 'ready' ? state.partNumbers : new Map<string, string>();
  const part = (s: string) => parts.get(s) || '—';

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Every scan attempt (new and duplicate), newest first. Dates are your local time (
        {timeZoneName()}).
      </p>

      <form
        aria-label="Scan history filters"
        onSubmit={(e) => e.preventDefault()}
        className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="text-sm font-semibold">
          Result
          <select
            data-testid="filter-result"
            className={selectClass}
            value={form.result}
            onChange={(e) => set('result', e.target.value as Form['result'])}
          >
            <option value="">All</option>
            <option value="new">New</option>
            <option value="duplicate">Duplicate</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Company
          <select
            data-testid="filter-company"
            className={selectClass}
            value={form.companyId}
            onChange={(e) => set('companyId', e.target.value)}
          >
            <option value="">All</option>
            {companies.state.status === 'ready' &&
              companies.state.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Source
          <select
            data-testid="filter-source"
            className={selectClass}
            value={form.source}
            onChange={(e) => set('source', e.target.value as Form['source'])}
          >
            <option value="">All</option>
            <option value="manual">Manual</option>
            <option value="scan">Photo (OCR)</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Operator
          <select
            data-testid="filter-operator"
            className={selectClass}
            value={form.scannedBy}
            onChange={(e) => set('scannedBy', e.target.value)}
          >
            <option value="">All</option>
            {users.state.status === 'ready' &&
              users.state.data.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          From
          <input
            data-testid="filter-from"
            type="date"
            className={selectClass}
            value={form.from}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          To
          <input
            data-testid="filter-to"
            type="date"
            className={selectClass}
            value={form.to}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-6">
          <Button
            variant="secondary"
            onClick={() => setForm(EMPTY)}
            disabled={!filtered}
            data-testid="filter-reset"
          >
            Clear filters
          </Button>
        </div>
      </form>
      {(companies.state.status === 'error' || users.state.status === 'error') && (
        <p role="alert" className="text-sm font-semibold text-danger">
          Some filter options could not be loaded.
        </p>
      )}
      {rangeProblem && (
        <p
          role="alert"
          className="rounded-md bg-danger-soft p-3 font-semibold text-danger"
          data-testid="range-error"
        >
          {rangeProblem}
        </p>
      )}

      {!rangeProblem && state.status === 'loading' && (
        <LoadingState label="Loading scan history…" />
      )}
      {!rangeProblem && state.status === 'error' && (
        <ErrorNotice message={state.message} onRetry={history.reload} />
      )}
      {!rangeProblem && state.status === 'ready' && state.entries.length === 0 && (
        <p className="text-ink-muted" data-testid="history-empty">
          {filtered ? 'No scans match these filters.' : 'No scan history yet.'}
        </p>
      )}
      {!rangeProblem && state.status === 'ready' && state.entries.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
            <table className="w-full text-left text-sm" data-testid="history-table">
              <thead className="bg-info-soft">
                <tr>
                  {[
                    'Time',
                    'Serial',
                    'Result',
                    'Company',
                    'Part number',
                    'Source',
                    'Scanned by',
                  ].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.entries.map((s) => (
                  <tr key={s.id} className="border-t border-line" data-testid="history-row">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.timestamp)}</td>
                    <td className="px-3 py-2 font-mono">{s.serial}</td>
                    <td className="px-3 py-2">
                      <ResultBadge result={s.result} />
                    </td>
                    <td className="px-3 py-2">{s.company}</td>
                    <td className="px-3 py-2">{part(s.serial)}</td>
                    <td className="px-3 py-2">{SOURCE_LABEL[s.source]}</td>
                    <td className="px-3 py-2">{s.scannedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {state.entries.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-line bg-surface p-3"
                data-testid="history-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold break-all">{s.serial}</span>
                  <ResultBadge result={s.result} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {s.company} · Part {part(s.serial)} · {SOURCE_LABEL[s.source]}
                </p>
                <p className="text-sm text-ink-muted">
                  {s.scannedByName} · {formatDateTime(s.timestamp)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-muted" data-testid="history-count">
              Showing {state.entries.length.toLocaleString()} scan
              {state.entries.length === 1 ? '' : 's'}
              {state.hasMore ? ' (more available)' : ' (end of history)'}
            </span>
            {state.hasMore && (
              <Button
                variant="secondary"
                onClick={() => void history.loadMore()}
                disabled={state.loadingMore}
                data-testid="history-more"
              >
                {state.loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            )}
            {state.moreError && (
              <span role="alert" className="text-sm font-semibold text-danger">
                {state.moreError}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
