import { useRef, type ReactNode } from 'react';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { msg, type MessageKey } from '../../i18n';
import type { ClassifiedRow, ImportPreview, RowClass } from '../../services/excel';
import { useExcelImport } from './useExcelImport';

const SHOW_LIMIT = 200;

interface CategoryDef {
  cls: RowClass;
  label: MessageKey;
  tone: string;
  blurb: MessageKey;
}

const CATEGORIES: CategoryDef[] = [
  { cls: 'new', label: 'import.catNew', tone: 'text-success', blurb: 'import.catNewBlurb' },
  {
    cls: 'existing',
    label: 'import.catExisting',
    tone: 'text-info',
    blurb: 'import.catExistingBlurb',
  },
  {
    cls: 'conflict',
    label: 'import.catConflict',
    tone: 'text-danger',
    blurb: 'import.catConflictBlurb',
  },
  {
    cls: 'duplicate',
    label: 'import.catDuplicate',
    tone: 'text-danger',
    blurb: 'import.catDuplicateBlurb',
  },
  {
    cls: 'invalid',
    label: 'import.catInvalid',
    tone: 'text-danger',
    blurb: 'import.catInvalidBlurb',
  },
];

function Stat({ label, value, tone = '' }: { label: MessageKey; value: number; tone?: string }) {
  const { t, number } = useI18n();
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <dt className="text-sm font-semibold text-ink-muted">{t(label)}</dt>
      <dd className={`text-2xl font-extrabold ${tone}`}>{number(value)}</dd>
    </div>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2">
      {children}
    </th>
  );
}

function RowsTable({
  cls,
  rows,
  multiSheet,
}: {
  cls: RowClass;
  rows: ClassifiedRow[];
  multiSheet: boolean;
}) {
  const shown = rows.slice(0, SHOW_LIMIT);
  const { t, text } = useI18n();
  /** The translatable reason when known, else the stored English text. */
  const reason = (r: ClassifiedRow) => text(r.reasonMsg ?? r.reason);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-info-soft">
          <tr>
            <Th>{multiSheet ? t('import.colSheetRow') : t('import.colRow')}</Th>
            <Th>{t('common.serial')}</Th>
            {cls === 'invalid' ? (
              <Th>{t('import.colProblem')}</Th>
            ) : (
              <>
                <Th>{t('import.colExcel')}</Th>
                {(cls === 'conflict' || cls === 'existing') && <Th>{t('import.colFirestore')}</Th>}
                {cls !== 'new' && (
                  <Th>{cls === 'conflict' ? t('import.colReason') : t('import.colNote')}</Th>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={`${r.sheet ?? ''}:${r.rowNumber}`} className="border-t border-line align-top">
              <td className="px-3 py-1.5">
                {multiSheet && r.sheet ? `${r.sheet} · ` : ''}
                {r.rowNumber}
              </td>
              <td className="px-3 py-1.5 font-mono break-all">{r.serial || '—'}</td>
              {cls === 'invalid' ? (
                <td className="px-3 py-1.5">{reason(r)}</td>
              ) : (
                <>
                  <td className="px-3 py-1.5">
                    {r.companyName} / {r.partNo || t('common.blank')}
                  </td>
                  {(cls === 'conflict' || cls === 'existing') && (
                    <td className="px-3 py-1.5">
                      {r.existing?.company} / {r.existing?.partNo || t('common.blank')}
                    </td>
                  )}
                  {cls !== 'new' && <td className="px-3 py-1.5">{reason(r)}</td>}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="px-3 py-2 text-sm text-ink-muted">
          {t('import.moreNotShown', { count: rows.length - shown.length })}
        </p>
      )}
    </div>
  );
}

function Preview({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const c = preview.counts;
  const { t, rich, number } = useI18n();
  const sheets =
    preview.sheets.length > 1
      ? msg('import.sheets', {
          count: preview.sheets.length,
          list: preview.sheets
            .map((x) => t('import.sheetRows', { name: x.name, count: x.rows }))
            .join(', '),
        })
      : msg('import.oneSheet', { name: preview.sheetName });
  return (
    <div className="space-y-5">
      <p className="text-ink-muted">
        {rich(
          'import.previewIntro',
          { filename: <span className="font-semibold text-ink">{preview.filename}</span> },
          { sheets },
        )}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="import.totalRows" value={c.total} />
        <Stat label="import.validRows" value={c.valid} />
        <Stat label="common.new" value={c.new} tone="text-success" />
        <Stat label="import.existing" value={c.existing} />
        <Stat label="import.conflicts" value={c.conflict} tone={c.conflict ? 'text-danger' : ''} />
        <Stat
          label="import.duplicates"
          value={c.duplicate}
          tone={c.duplicate ? 'text-danger' : ''}
        />
        <Stat label="import.invalid" value={c.invalid} tone={c.invalid ? 'text-danger' : ''} />
      </dl>

      <div className="space-y-2">
        {CATEGORIES.map((cat) => {
          const rows = preview.rows.filter((r) => r.cls === cat.cls);
          if (rows.length === 0) return null;
          return (
            <details key={cat.cls} className="rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer px-3 py-2 font-semibold">
                <span className={cat.tone}>{t(cat.label)}</span> — {number(rows.length)}
                <span className="ml-2 text-sm font-normal text-ink-muted">{t(cat.blurb)}</span>
              </summary>
              <RowsTable cls={cat.cls} rows={rows} multiSheet={preview.sheets.length > 1} />
            </details>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="mb-3 text-sm text-ink-muted">{t('import.onlyNew', { count: c.new })}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={onConfirm} disabled={c.new === 0} className="min-h-14 text-lg">
            {c.new === 0 ? t('import.nothingNew') : t('import.importNew', { count: c.new })}
          </Button>
          <Button variant="secondary" onClick={onCancel} className="min-h-14">
            {c.new === 0 ? t('import.chooseAnother') : t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ImportPanel({ onImported }: { onImported?: () => void }) {
  const { state, selectFile, confirm, reset } = useExcelImport(onImported);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = state.step === 'checking' || state.step === 'importing';
  const { t, text, rich } = useI18n();

  return (
    <div className="space-y-5">
      {(state.step === 'idle' || state.step === 'error') && (
        <div className="max-w-xl">
          <label htmlFor="import-file" className="block text-sm font-semibold">
            {t('import.fileLabel')}
          </label>
          <input
            ref={inputRef}
            id="import-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // allow re-selecting the same file
              if (file) void selectFile(file);
            }}
            className="mt-1 block min-h-touch w-full rounded-md border border-line bg-surface p-2 text-base file:mr-3 file:min-h-touch file:rounded-md file:border-0 file:bg-action file:px-4 file:font-semibold file:text-on-accent"
          />
          <p className="mt-2 text-sm text-ink-muted">
            {/* The header names are the file format (always English), so they are not translated. */}
            {rich('import.fileHelp', {
              columns: <strong>Serial Number, Part Number, Company</strong>,
            })}
          </p>
        </div>
      )}

      <div aria-live="polite">
        {state.step === 'error' && (
          <div
            role="alert"
            className="max-w-2xl rounded-lg border-2 border-danger bg-danger-soft p-4"
          >
            <p className="text-xl font-bold text-danger">{t('import.rejected')}</p>
            <p className="mt-1">{text(state.message)}</p>
            <p className="mt-1 text-sm text-ink-muted">{t('import.nothingWritten')}</p>
          </div>
        )}
        {state.step === 'checking' && (
          <LoadingState
            label={
              state.total > 0
                ? t('import.checking', {
                    filename: state.filename,
                    checked: state.checked,
                    total: state.total,
                  })
                : t('import.reading', { filename: state.filename })
            }
          />
        )}
        {state.step === 'preview' && (
          <Preview preview={state.preview} onConfirm={() => void confirm()} onCancel={reset} />
        )}
        {state.step === 'importing' && (
          <LoadingState label={t('import.importing', { done: state.done, total: state.total })} />
        )}
        {state.step === 'done' && (
          <div
            role="status"
            className={`max-w-2xl rounded-lg border-2 p-4 ${state.outcome.status === 'completed' ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft'}`}
          >
            <p
              className={`text-xl font-bold ${state.outcome.status === 'completed' ? 'text-success' : 'text-danger'}`}
            >
              {state.outcome.status === 'completed' ? t('import.complete') : t('import.stopped')}
            </p>
            {state.outcome.status === 'failed' && (
              <p className="mt-1 font-semibold">
                {t('import.notProcessed', {
                  error: text(state.outcome.errorMsg ?? state.outcome.error),
                  count: state.outcome.notProcessed,
                })}
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="import.created" value={state.outcome.created} tone="text-success" />
              <Stat label="import.skipped" value={state.outcome.skipped} />
              <Stat
                label="import.conflicts"
                value={state.outcome.conflicts}
                tone={state.outcome.conflicts ? 'text-danger' : ''}
              />
              <Stat label="import.duplicates" value={state.outcome.duplicates} />
              <Stat label="import.invalid" value={state.outcome.invalid} />
            </dl>
            {(state.outcome.raceSkipped > 0 || state.outcome.raceConflicts > 0) && (
              <p className="mt-3 text-sm">
                {t('import.raced', {
                  count: state.outcome.raceSkipped + state.outcome.raceConflicts,
                })}
              </p>
            )}
            {!state.historyRecorded && (
              <p role="alert" className="mt-3 text-sm font-semibold text-danger">
                {t('import.historyNotSaved')}
              </p>
            )}
            <Button variant="secondary" onClick={reset} className="mt-4">
              {t('import.another')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
