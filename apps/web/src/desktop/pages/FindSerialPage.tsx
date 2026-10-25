import { useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { dataService } from '../../data';
import { ReprintLabel } from '../../features/reprint/ReprintLabel';
import { recordedBy } from '../../features/stations/recordedBy';
import { useI18n } from '../../hooks/useI18n';
import type { Text } from '../../i18n';
import { errorText, toAppError } from '../../services/errors';
import type { FoundSerial } from '../../types';

type Search =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'error'; query: string; message: Text }
  | { status: 'ready'; query: string; results: FoundSerial[] };

/**
 * Admin: find ANY serial, registered at a station or imported from Excel (exact, or by its first
 * characters), and print its label again on this station's printer. Every reprint is logged.
 */
export default function FindSerialPage() {
  const { t, dateTime } = useI18n();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle' });

  const run = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearch({ status: 'loading', query: trimmed });
    try {
      const results = await dataService.findSerials(trimmed);
      setSearch({ status: 'ready', query: trimmed, results });
    } catch (e) {
      setSearch({ status: 'error', query: trimmed, message: errorText(toAppError(e)) });
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(query);
  };

  const source = (f: FoundSerial) =>
    f.record.source === 'excel'
      ? f.record.importFile
        ? t('findSerial.sourceImportedFile', { file: f.record.importFile })
        : t('findSerial.sourceImported')
      : t('findSerial.sourceStation');

  return (
    <section aria-labelledby="page-title" className="space-y-6">
      <div>
        <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
          {t('findSerial.title')}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-muted">{t('findSerial.intro')}</p>
      </div>

      <form
        onSubmit={submit}
        role="search"
        className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <TextField
            label={t('findSerial.label')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            variant="code"
            data-testid="find-serial-input"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={!query.trim() || search.status === 'loading'}>
          {t('findSerial.search')}
        </Button>
      </form>

      {search.status === 'loading' && <LoadingState label={t('findSerial.searching')} />}
      {search.status === 'error' && (
        <ErrorNotice message={search.message} onRetry={() => void run(search.query)} />
      )}
      {search.status === 'ready' && search.results.length === 0 && (
        <p className="text-ink-muted" data-testid="find-serial-empty">
          {t('findSerial.none', { query: search.query })}
        </p>
      )}
      {search.status === 'ready' && search.results.length > 0 && (
        <ul className="space-y-3" data-testid="find-serial-results">
          {search.results.map((f) => (
            <li
              key={`${f.record.companyId}|${f.record.serial}`}
              className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-[1fr_auto] md:items-start"
              data-testid="find-serial-result"
            >
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="sr-only">{t('common.serial')}</dt>
                <dd className="font-mono text-lg font-bold break-all sm:col-span-2">
                  {f.record.serial}
                </dd>
                <dt className="font-semibold text-ink-muted">{t('common.company')}</dt>
                <dd>{f.record.company}</dd>
                <dt className="font-semibold text-ink-muted">{t('common.partNumber')}</dt>
                <dd>{f.record.partNo || '—'}</dd>
                <dt className="font-semibold text-ink-muted">{t('common.source')}</dt>
                <dd className="break-all">{source(f)}</dd>
                <dt className="font-semibold text-ink-muted">{t('findSerial.station')}</dt>
                <dd>{recordedBy(t, f.record.nodeName, f.record.scannedByName) || '—'}</dd>
                <dt className="font-semibold text-ink-muted">{t('common.time')}</dt>
                <dd>{dateTime(f.record.scannedAt)}</dd>
              </dl>
              {f.company ? (
                <ReprintLabel companyId={f.record.companyId} serial={f.record.serial} />
              ) : (
                <p className="text-sm text-ink-muted">{t('findSerial.companyGone')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
