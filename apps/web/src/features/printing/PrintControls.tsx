import { Button } from '../../components/ui/Button';
import { desktopBridge } from '../../desktop/bridge';
import { useI18n } from '../../hooks/useI18n';
import type { LabelData } from '../../services/printing';
import { usePrintLabel } from './usePrintLabel';

/**
 * Print Label / Print Again for a registered label. Only rendered for a NEW serial whose label
 * code was generated. Wording never claims the label was printed: the browser can only open the
 * print dialog.
 */
export function PrintControls({ label }: { label: LabelData }) {
  const { state, print } = usePrintLabel(label);
  const { t } = useI18n();
  const busy = state.phase === 'preparing';
  const again = state.phase === 'requested';

  return (
    <div className="space-y-2" data-testid="print-controls" data-print-phase={state.phase}>
      <Button
        variant="success"
        onClick={() => void print()}
        disabled={busy}
        aria-busy={busy}
        data-testid="print-button"
        className="min-h-14 w-full text-lg"
      >
        {busy ? t('print.opening') : again ? t('print.again') : t('print.print')}
      </Button>
      <div aria-live="polite">
        {state.phase === 'requested' && (
          <p data-testid="print-status" className="text-sm text-ink-muted">
            {/* Desktop: printed silently; web: only a print dialog was opened. */}
            {t(desktopBridge() ? 'print.sent' : 'print.requested', { count: state.count })}
          </p>
        )}
        {state.phase === 'error' && (
          <p data-testid="print-error" role="alert" className="text-sm font-semibold text-danger">
            {t(state.noPrinter ? 'print.noPrinter' : 'print.failed')}
          </p>
        )}
      </div>
    </div>
  );
}
