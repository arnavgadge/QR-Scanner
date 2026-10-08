import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useUser } from '../../hooks/useUser';
import { useSerialExport } from './useSerialExport';

export function ExportPanel() {
  const user = useUser();
  const { state, start, downloadAgain } = useSerialExport(user.name);
  const busy = state.step === 'preparing' || state.step === 'generating';

  return (
    <div className="max-w-xl space-y-4">
      <Button onClick={() => void start()} disabled={busy} className="min-h-14 text-lg">
        {busy ? 'Exporting…' : state.step === 'ready' ? 'Export again' : 'Export Excel'}
      </Button>

      <div aria-live="polite">
        {state.step === 'preparing' && (
          <LoadingState
            label={
              state.serialsRead > 0
                ? `Preparing export… ${state.serialsRead.toLocaleString()} serials read`
                : 'Preparing export…'
            }
          />
        )}
        {state.step === 'generating' && <LoadingState label="Generating Excel…" />}
        {state.step === 'ready' && (
          <div role="status" className="rounded-lg border-2 border-success bg-success-soft p-4">
            <p className="text-xl font-bold text-success">Download ready</p>
            <p className="mt-1 break-all">
              <span className="font-mono">{state.filename}</span> —{' '}
              {state.recordCount.toLocaleString()} serial record
              {state.recordCount === 1 ? '' : 's'}
              {state.recordCount === 0 && ' (no serials are registered yet)'}
            </p>
            {!state.historyRecorded && (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                The file was created, but the export could not be recorded in the export history.
              </p>
            )}
            <Button variant="secondary" onClick={downloadAgain} className="mt-3">
              Download again
            </Button>
          </div>
        )}
        {state.step === 'error' && (
          <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft p-4">
            <p className="text-xl font-bold text-danger">Export failed</p>
            <p className="mt-1">{state.message}</p>
            <p className="mt-1 text-sm text-ink-muted">No file was produced.</p>
          </div>
        )}
      </div>
    </div>
  );
}
