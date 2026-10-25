import { useCallback, useRef, useState } from 'react';
import { dataService } from '../../data';
import { errorText, toAppError } from '../../services/errors';
import { downloadBlob } from '../../utils/download';

import { logError } from '../../utils/log';
import { msg, type Text } from '../../i18n/core';
export type ExportState =
  | { step: 'idle' }
  | { step: 'preparing'; serialsRead: number }
  | { step: 'generating' }
  | { step: 'ready'; filename: string; recordCount: number; historyRecorded: boolean }
  | { step: 'error'; message: Text };

/** idle -> preparing -> generating -> ready | error. "ready" only after the file really exists. */
export function useSerialExport(exportedBy: string) {
  const [state, setState] = useState<ExportState>({ step: 'idle' });
  const running = useRef(false);
  const lastFile = useRef<{ blob: Blob; filename: string } | null>(null);

  const start = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    lastFile.current = null;
    setState({ step: 'preparing', serialsRead: 0 });
    try {
      const result = await dataService.exportSerials({
        exportedBy,
        onPhase: (phase) => {
          if (phase === 'generating') setState({ step: 'generating' });
        },
        onProgress: (serialsRead) => setState({ step: 'preparing', serialsRead }),
      });
      lastFile.current = { blob: result.blob, filename: result.filename };
      downloadBlob(result.blob, result.filename);
      // Audit entry (who exported, when, how many records). Best effort: a failure here does not
      // undo the export, but the admin is told it was not recorded.
      let historyRecorded = true;
      try {
        await dataService.recordExport({
          filename: result.filename,
          recordCount: result.recordCount,
        });
      } catch (e) {
        historyRecorded = false;
        logError('Could not record export history', e);
      }
      setState({
        step: 'ready',
        filename: result.filename,
        recordCount: result.recordCount,
        historyRecorded,
      });
    } catch (e) {
      setState({
        step: 'error',
        message: errorText(toAppError(e, msg('export.failedRetry'))),
      });
    } finally {
      running.current = false;
    }
  }, [exportedBy]);

  /** Re-download the file already generated (no new Firestore reads). */
  const downloadAgain = useCallback(() => {
    if (lastFile.current) downloadBlob(lastFile.current.blob, lastFile.current.filename);
  }, []);

  return { state, start, downloadAgain };
}
