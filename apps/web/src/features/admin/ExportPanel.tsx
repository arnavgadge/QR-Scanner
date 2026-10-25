import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../hooks/useI18n';
import { useUser } from '../../hooks/useUser';
import { useSerialExport } from './useSerialExport';

export function ExportPanel() {
  const user = useUser();
  const { state, start, downloadAgain } = useSerialExport(user.name);
  const busy = state.step === 'preparing' || state.step === 'generating';
  const { t, text, rich } = useI18n();

  return (
    <div className="max-w-xl space-y-4">
      <Button onClick={() => void start()} disabled={busy} className="min-h-14 text-lg">
        {busy
          ? t('export.exporting')
          : state.step === 'ready'
            ? t('export.again')
            : t('export.start')}
      </Button>

      <div aria-live="polite">
        {state.step === 'preparing' && (
          <LoadingState
            label={
              state.serialsRead > 0
                ? t('export.preparingCount', { count: state.serialsRead })
                : t('export.preparing')
            }
          />
        )}
        {state.step === 'generating' && <LoadingState label={t('export.generating')} />}
        {state.step === 'ready' && (
          <div role="status" className="rounded-lg border-2 border-success bg-success-soft p-4">
            <p className="text-xl font-bold text-success">{t('export.ready')}</p>
            <p className="mt-1 break-all">
              {rich(
                'export.readyDetail',
                { filename: <span className="font-mono">{state.filename}</span> },
                { count: state.recordCount },
              )}
              {state.recordCount === 0 && ` ${t('export.readyEmpty')}`}
            </p>
            {!state.historyRecorded && (
              <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                {t('export.historyNotRecorded')}
              </p>
            )}
            <Button variant="secondary" onClick={downloadAgain} className="mt-3">
              {t('export.downloadAgain')}
            </Button>
          </div>
        )}
        {state.step === 'error' && (
          <div role="alert" className="rounded-lg border-2 border-danger bg-danger-soft p-4">
            <p className="text-xl font-bold text-danger">{t('export.failed')}</p>
            <p className="mt-1">{text(state.message)}</p>
            <p className="mt-1 text-sm text-ink-muted">{t('export.noFile')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
