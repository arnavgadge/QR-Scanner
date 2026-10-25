import { useCallback, useRef, useState } from 'react';
import { dataService } from '../../data';
import type { ImportOutcome, ImportPreview } from '../../services/excel';
import { errorText, toAppError } from '../../services/errors';

import { msg, type Text } from '../../i18n/core';
export type ImportState =
  | { step: 'idle' }
  | { step: 'checking'; filename: string; checked: number; total: number }
  | { step: 'preview'; preview: ImportPreview }
  | { step: 'importing'; preview: ImportPreview; done: number; total: number }
  | { step: 'done'; outcome: ImportOutcome; historyRecorded: boolean }
  | { step: 'error'; message: Text };

/**
 * idle -> checking (parse + compare, NO writes) -> preview -> importing (only after the admin
 * confirms) -> done. Selecting a file never writes anything.
 */
export function useExcelImport(onImported?: () => void) {
  const [state, setState] = useState<ImportState>({ step: 'idle' });
  const busy = useRef(false);

  const selectFile = useCallback(async (file: File) => {
    if (busy.current) return;
    busy.current = true;
    setState({ step: 'checking', filename: file.name, checked: 0, total: 0 });
    try {
      const preview = await dataService.previewImport(file, (checked, total) =>
        setState({ step: 'checking', filename: file.name, checked, total }),
      );
      setState({ step: 'preview', preview });
    } catch (e) {
      setState({ step: 'error', message: errorText(toAppError(e, msg('import.readFailed'))) });
    } finally {
      busy.current = false;
    }
  }, []);

  const confirm = useCallback(async () => {
    if (busy.current || state.step !== 'preview') return;
    busy.current = true;
    const preview = state.preview;
    setState({ step: 'importing', preview, done: 0, total: preview.counts.new });
    try {
      const { outcome, historyRecorded } = await dataService.confirmImport(preview, (done, total) =>
        setState({ step: 'importing', preview, done, total }),
      );
      setState({ step: 'done', outcome, historyRecorded });
      onImported?.();
    } catch (e) {
      setState({ step: 'error', message: errorText(toAppError(e, msg('import.failed'))) });
    } finally {
      busy.current = false;
    }
  }, [state, onImported]);

  const reset = useCallback(() => setState({ step: 'idle' }), []);

  return { state, selectFile, confirm, reset };
}
