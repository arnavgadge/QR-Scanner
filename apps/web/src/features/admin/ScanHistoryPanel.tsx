import { useCallback, useMemo, useState } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useI18n } from '../../hooks/useI18n';
import { recordedBy } from '../stations/recordedBy';
import type { MessageKey } from '../../i18n';
import { inclusiveRange, timeZoneName } from '../../services/admin/dateRanges';
import { dataService, type ScanHistoryFilters } from '../../data';
import type { ScanLog, ScanResult } from '../../types';
import { useScanHistory } from './useScanHistory';

interface Form {
  /** Desktop also lists imported serials and label reprints (their own kinds of history row). */
  result: '' | ScanResult | 'import' | 'reprint';
  companyId: string;
  source: '' | 'manual' | 'scan';
  scannedBy: string;
  from: string;
  to: string;
}
const EMPTY: Form = { result: '', companyId: '', source: '', scannedBy: '', from: '', to: '' };

const SOURCE_LABEL: Record<ScanLog['source'], MessageKey> = {
  manual: 'source.manual',
  scan: 'source.scan',
  excel: 'source.excel',
};

function ResultBadge({ log }: { log: ScanLog }) {
  const { t } = useI18n();
  if (log.kind === 'import' || log.kind === 'reprint') {
    return (
      <span
        className="rounded bg-info-soft px-2 py-0.5 text-sm font-bold text-ink"
        data-testid={`badge-${log.kind}`}
      >
        {t(log.kind === 'import' ? 'scanHistory.badgeImported' : 'scanHistory.badgeReprint')}
      </span>
    );
  }
  return log.result === 'duplicate' ? (
    <span className="rounded bg-danger-soft px-2 py-0.5 text-sm font-bold text-danger">
      {t('common.badgeDuplicate')}
    </span>
  ) : (
    <span className="rounded bg-success-soft px-2 py-0.5 text-sm font-bold text-success">
      {t('common.badgeNew')}
    </span>
  );
}

const selectClass = 'mt-1 min-h-touch w-full rounded-md border border-line bg-surface px-2';

/**
 * Admin scan history: every scan ATTEMPT (scan_log), newest first, with filters and "load more"
 * pagination. On the desktop server it also lists serials added by Excel imports ("Imported")
 * and every label reprint ("Reprint": serial, station, administrator, time).
 */
export function ScanHistoryPanel() {
  const [form, setForm] = useState<Form>(EMPTY);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const { t, text, dateTime } = useI18n();

  const companiesLoader = useCallback(() => dataService.getAllCompanies(), []);
  // Who registered: stations on the desktop, people in the web app.
  const usersLoader = useCallback(() => dataService.getRecorders(), []);
  const companies = useAsyncData(companiesLoader, 'companies.loadAllFailed');
  const users = useAsyncData(usersLoader, 'scanHistory.usersFailed');

  const rangeProblem = Boolean(form.from && form.to && form.from > form.to);

  const filters = useMemo<ScanHistoryFilters>(() => {
    const range = rangeProblem ? {} : inclusiveRange(form.from, form.to);
    return {
      ...(form.result === 'import' || form.result === 'reprint'
        ? { kind: form.result }
        : form.result
          ? { result: form.result }
          : {}),
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
      <p className="text-sm text-ink-muted">{t('scanHistory.intro', { tz: timeZoneName() })}</p>

      <form
        aria-label={t('scanHistory.filtersAria')}
        onSubmit={(e) => e.preventDefault()}
        className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        <label className="text-sm font-semibold">
          {t('common.result')}
          <select
            data-testid="filter-result"
            className={selectClass}
            value={form.result}
            onChange={(e) => set('result', e.target.value as Form['result'])}
          >
            <option value="">{t('common.all')}</option>
            <option value="new">{t('common.new')}</option>
            <option value="duplicate">{t('common.duplicate')}</option>
            {dataService.capabilities.serialLookup && (
              <>
                <option value="import">{t('scanHistory.optImported')}</option>
                <option value="reprint">{t('scanHistory.optReprint')}</option>
              </>
            )}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {t('common.company')}
          <select
            data-testid="filter-company"
            className={selectClass}
            value={form.companyId}
            onChange={(e) => set('companyId', e.target.value)}
          >
            <option value="">{t('common.all')}</option>
            {companies.state.status === 'ready' &&
              companies.state.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {t('common.source')}
          <select
            data-testid="filter-source"
            className={selectClass}
            value={form.source}
            onChange={(e) => set('source', e.target.value as Form['source'])}
          >
            <option value="">{t('common.all')}</option>
            <option value="manual">{t('source.manual')}</option>
            <option value="scan">{t('source.scan')}</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          {dataService.capabilities.stations ? t('common.station') : t('common.operator')}
          <select
            data-testid="filter-operator"
            className={selectClass}
            value={form.scannedBy}
            onChange={(e) => set('scannedBy', e.target.value)}
          >
            <option value="">{t('common.all')}</option>
            {users.state.status === 'ready' &&
              users.state.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {t('scanHistory.from')}
          <input
            data-testid="filter-from"
            type="date"
            className={selectClass}
            value={form.from}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          {t('scanHistory.to')}
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
            {t('scanHistory.clear')}
          </Button>
        </div>
      </form>
      {(companies.state.status === 'error' || users.state.status === 'error') && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t('scanHistory.optionsFailed')}
        </p>
      )}
      {rangeProblem && (
        <p
          role="alert"
          className="rounded-md bg-danger-soft p-3 font-semibold text-danger"
          data-testid="range-error"
        >
          {t('scanHistory.rangeProblem')}
        </p>
      )}

      {!rangeProblem && state.status === 'loading' && (
        <LoadingState label={t('scanHistory.loading')} />
      )}
      {!rangeProblem && state.status === 'error' && (
        <ErrorNotice message={state.message} onRetry={history.reload} />
      )}
      {!rangeProblem && state.status === 'ready' && state.entries.length === 0 && (
        <p className="text-ink-muted" data-testid="history-empty">
          {filtered ? t('scanHistory.noMatch') : t('scanHistory.empty')}
        </p>
      )}
      {!rangeProblem && state.status === 'ready' && state.entries.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
            <table className="w-full text-left text-sm" data-testid="history-table">
              <thead className="bg-info-soft">
                <tr>
                  {[
                    t('common.time'),
                    t('common.serial'),
                    t('common.result'),
                    t('common.company'),
                    t('common.partNumber'),
                    t('common.source'),
                    t('common.scannedBy'),
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
                    <td className="px-3 py-2 whitespace-nowrap">{dateTime(s.timestamp)}</td>
                    <td className="px-3 py-2 font-mono">{s.serial}</td>
                    <td className="px-3 py-2">
                      <ResultBadge log={s} />
                    </td>
                    <td className="px-3 py-2">{s.company}</td>
                    <td className="px-3 py-2">{part(s.serial)}</td>
                    <td className="px-3 py-2">{t(SOURCE_LABEL[s.source])}</td>
                    <td className="px-3 py-2">{recordedBy(t, s.nodeName, s.scannedByName)}</td>
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
                  <ResultBadge log={s} />
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {s.company} · {t('scanHistory.part', { part: part(s.serial) })} ·{' '}
                  {t(SOURCE_LABEL[s.source])}
                </p>
                <p className="text-sm text-ink-muted">
                  {recordedBy(t, s.nodeName, s.scannedByName)} · {dateTime(s.timestamp)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-muted" data-testid="history-count">
              {t('scanHistory.showing', { count: state.entries.length })}
              {state.hasMore ? t('scanHistory.more') : t('scanHistory.end')}
            </span>
            {state.hasMore && (
              <Button
                variant="secondary"
                onClick={() => void history.loadMore()}
                disabled={state.loadingMore}
                data-testid="history-more"
              >
                {state.loadingMore ? t('common.loading') : t('scanHistory.loadMore')}
              </Button>
            )}
            {state.moreError && (
              <span role="alert" className="text-sm font-semibold text-danger">
                {text(state.moreError)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
