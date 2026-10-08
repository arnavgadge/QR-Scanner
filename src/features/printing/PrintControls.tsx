import { Button } from '../../components/ui/Button';
import type { LabelData } from '../../services/printing';
import { usePrintLabel } from './usePrintLabel';

/**
 * Print Label / Print Again for a registered label. Only rendered for a NEW serial whose label
 * code was generated. Wording never claims the label was printed: the browser can only open the
 * print dialog.
 */
export function PrintControls({ label }: { label: LabelData }) {
  const { state, print } = usePrintLabel(label);
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
        {busy ? 'Opening print dialog…' : again ? 'Print Again' : 'Print Label'}
      </Button>
      <div aria-live="polite">
        {state.phase === 'requested' && (
          <p data-testid="print-status" className="text-sm text-ink-muted">
            Print dialog requested{state.count > 1 ? ` (${state.count} times)` : ''}. The browser
            cannot confirm that a label was printed: check the printer. Use Print Again if it did
            not print.
          </p>
        )}
        {state.phase === 'error' && (
          <p data-testid="print-error" role="alert" className="text-sm font-semibold text-danger">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
