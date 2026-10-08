import { useCallback, useRef, useState } from 'react';
import { PRINT_FAILED_MESSAGE, printLabel, type LabelData } from '../../services/printing';

import { logError } from '../../utils/log';
/**
 * ready      -> nothing requested yet
 * preparing  -> opening the print dialog (button disabled: no double dialogs)
 * requested  -> the print dialog was requested `count` times. NOT "printed": the browser cannot
 *               tell whether a printer actually produced a label.
 * error      -> the label could not be prepared for printing
 */
export type PrintState =
  | { phase: 'ready' }
  | { phase: 'preparing' }
  | { phase: 'requested'; count: number }
  | { phase: 'error'; message: string };

/** Print controller for ONE already-registered label. Printing never registers anything. */
export function usePrintLabel(label: LabelData) {
  const [state, setState] = useState<PrintState>({ phase: 'ready' });
  const busy = useRef(false); // synchronous guard against a fast double click
  const count = useRef(0);

  const print = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState({ phase: 'preparing' });
    try {
      await printLabel(label);
      count.current += 1;
      setState({ phase: 'requested', count: count.current });
    } catch (e) {
      logError('Label print preparation failed', e);
      setState({ phase: 'error', message: PRINT_FAILED_MESSAGE });
    } finally {
      busy.current = false; // not permanent: the operator may need to print again
    }
  }, [label]);

  return { state, print };
}
