import { useRef, type ReactNode } from 'react';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import type { ClassifiedRow, ImportPreview, RowClass } from '../../services/excel';
import { useExcelImport } from './useExcelImport';

const SHOW_LIMIT = 200;

interface CategoryDef {
  cls: RowClass;
  label: string;
  tone: string;
  blurb: string;
}

const CATEGORIES: CategoryDef[] = [
  { cls: 'new', label: 'New', tone: 'text-success', blurb: 'Will be created (source: excel).' },
  {
    cls: 'existing',
    label: 'Existing / skipped',
    tone: 'text-info',
    blurb: 'Already registered with matching data. Not modified.',
  },
  {
    cls: 'conflict',
    label: 'Conflicts',
    tone: 'text-danger',
    blurb: 'Already registered with different data. Not modified.',
  },
  {
    cls: 'duplicate',
    label: 'Duplicates in file',
    tone: 'text-danger',
    blurb: 'Serial repeated in this file. Only the first occurrence counts.',
  },
  {
    cls: 'invalid',
    label: 'Invalid',
    tone: 'text-danger',
    blurb: 'Missing or malformed data. Not imported.',
  },
];

function Stat({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className={`text-2xl font-extrabold ${tone}`}>{value.toLocaleString()}</dd>
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-info-soft">
          <tr>
            <Th>{multiSheet ? 'Sheet / row' : 'Row'}</Th>
            <Th>Serial</Th>
            {cls === 'invalid' ? (
              <Th>Problem</Th>
            ) : (
              <>
                <Th>Excel company / part</Th>
                {(cls === 'conflict' || cls === 'existing') && <Th>Firestore company / part</Th>}
                {cls !== 'new' && <Th>{cls === 'conflict' ? 'Reason' : 'Note'}</Th>}
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
                <td className="px-3 py-1.5">{r.reason}</td>
              ) : (
                <>
                  <td className="px-3 py-1.5">
                    {r.companyName} / {r.partNo || '(blank)'}
                  </td>
                  {(cls === 'conflict' || cls === 'existing') && (
                    <td className="px-3 py-1.5">
                      {r.existing?.company} / {r.existing?.partNo || '(blank)'}
                    </td>
                  )}
                  {cls !== 'new' && <td className="px-3 py-1.5">{r.reason}</td>}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="px-3 py-2 text-sm text-ink-muted">
          …and {(rows.length - shown.length).toLocaleString()} more not shown.
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
  return (
    <div className="space-y-5">
      <p className="text-ink-muted">
        <span className="font-semibold text-ink">{preview.filename}</span> (
        {preview.sheets.length > 1
          ? `${preview.sheets.length} sheets: ${preview.sheets.map((x) => `“${x.name}” ${x.rows.toLocaleString()} rows`).join(', ')}`
          : `sheet “${preview.sheetName}”`}
        ). Nothing has been written yet.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Total rows" value={c.total} />
        <Stat label="Valid rows" value={c.valid} />
        <Stat label="New" value={c.new} tone="text-success" />
        <Stat label="Existing" value={c.existing} />
        <Stat label="Conflicts" value={c.conflict} tone={c.conflict ? 'text-danger' : ''} />
        <Stat label="Duplicates" value={c.duplicate} tone={c.duplicate ? 'text-danger' : ''} />
        <Stat label="Invalid" value={c.invalid} tone={c.invalid ? 'text-danger' : ''} />
      </dl>

      <div className="space-y-2">
        {CATEGORIES.map((cat) => {
          const rows = preview.rows.filter((r) => r.cls === cat.cls);
          if (rows.length === 0) return null;
          return (
            <details key={cat.cls} className="rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer px-3 py-2 font-semibold">
                <span className={cat.tone}>{cat.label}</span> — {rows.length.toLocaleString()}
                <span className="ml-2 text-sm font-normal text-ink-muted">{cat.blurb}</span>
              </summary>
              <RowsTable cls={cat.cls} rows={rows} multiSheet={preview.sheets.length > 1} />
            </details>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="mb-3 text-sm text-ink-muted">
          Only the {c.new.toLocaleString()} new record{c.new === 1 ? '' : 's'} will be created.
          Existing, conflicting, duplicate and invalid rows are never written. A serial registered
          by someone else after this preview is skipped, never overwritten.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={onConfirm} disabled={c.new === 0} className="min-h-14 text-lg">
            {c.new === 0
              ? 'Nothing new to import'
              : `Import ${c.new.toLocaleString()} New Record${c.new === 1 ? '' : 's'}`}
          </Button>
          <Button variant="secondary" onClick={onCancel} className="min-h-14">
            {c.new === 0 ? 'Choose another file' : 'Cancel'}
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

  return (
    <div className="space-y-5">
      {(state.step === 'idle' || state.step === 'error') && (
        <div className="max-w-xl">
          <label htmlFor="import-file" className="block text-sm font-semibold">
            Excel file (.xlsx)
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
            className="mt-1 block min-h-touch w-full rounded-md border border-line bg-surface p-2 text-base file:mr-3 file:min-h-touch file:rounded-md file:border-0 file:bg-action file:px-4 file:font-semibold file:text-white"
          />
          <p className="mt-2 text-sm text-ink-muted">
            First row must contain the headers <strong>Serial Number, Part Number, Company</strong>{' '}
            (a Company ID column is also accepted). Choosing a file only previews it.
          </p>
        </div>
      )}

      <div aria-live="polite">
        {state.step === 'error' && (
          <div
            role="alert"
            className="max-w-2xl rounded-lg border-2 border-danger bg-danger-soft p-4"
          >
            <p className="text-xl font-bold text-danger">Import rejected</p>
            <p className="mt-1">{state.message}</p>
            <p className="mt-1 text-sm text-ink-muted">Nothing was written to Firestore.</p>
          </div>
        )}
        {state.step === 'checking' && (
          <LoadingState
            label={
              state.total > 0
                ? `Checking ${state.filename} against Firestore… ${state.checked.toLocaleString()} / ${state.total.toLocaleString()}`
                : `Reading ${state.filename}…`
            }
          />
        )}
        {state.step === 'preview' && (
          <Preview preview={state.preview} onConfirm={() => void confirm()} onCancel={reset} />
        )}
        {state.step === 'importing' && (
          <LoadingState
            label={`Importing… ${state.done.toLocaleString()} / ${state.total.toLocaleString()} records`}
          />
        )}
        {state.step === 'done' && (
          <div
            role="status"
            className={`max-w-2xl rounded-lg border-2 p-4 ${state.outcome.status === 'completed' ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft'}`}
          >
            <p
              className={`text-xl font-bold ${state.outcome.status === 'completed' ? 'text-success' : 'text-danger'}`}
            >
              {state.outcome.status === 'completed' ? 'Import complete' : 'Import stopped'}
            </p>
            {state.outcome.status === 'failed' && (
              <p className="mt-1 font-semibold">
                {state.outcome.error} {state.outcome.notProcessed.toLocaleString()} new row(s) were
                not processed; records already created were kept.
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Created" value={state.outcome.created} tone="text-success" />
              <Stat label="Skipped" value={state.outcome.skipped} />
              <Stat
                label="Conflicts"
                value={state.outcome.conflicts}
                tone={state.outcome.conflicts ? 'text-danger' : ''}
              />
              <Stat label="Duplicates" value={state.outcome.duplicates} />
              <Stat label="Invalid" value={state.outcome.invalid} />
            </dl>
            {(state.outcome.raceSkipped > 0 || state.outcome.raceConflicts > 0) && (
              <p className="mt-3 text-sm">
                {state.outcome.raceSkipped + state.outcome.raceConflicts} serial(s) were registered
                by someone else after the preview and were left untouched.
              </p>
            )}
            {!state.historyRecorded && (
              <p role="alert" className="mt-3 text-sm font-semibold text-danger">
                The import ran, but its history entry could not be saved.
              </p>
            )}
            <Button variant="secondary" onClick={reset} className="mt-4">
              Import another file
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
