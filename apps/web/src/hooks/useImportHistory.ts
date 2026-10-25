import { useCallback, useEffect, useState } from 'react';
import { errorText, toAppError } from '../services/errors';
import { dataService } from '../data';
import type { ImportHistoryEntry } from '../types';

import { msg, type Text } from '../i18n/core';
export type ImportHistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: Text }
  | { status: 'ready'; entries: ImportHistoryEntry[] };

/** One limited query (latest 20 imports). `refresh` re-queries (e.g. after an import). */
export function useImportHistory(count = 20) {
  const [state, setState] = useState<ImportHistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    dataService
      .getImportHistory(count)
      .then((entries) => {
        if (!cancelled) setState({ status: 'ready', entries });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: errorText(toAppError(e, msg('importHistory.loadFailed'))),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [count, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);
  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, refresh, reload };
}
