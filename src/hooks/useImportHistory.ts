import { useCallback, useEffect, useState } from 'react';
import { toAppError } from '../services/errors';
import { getImportHistory } from '../services/excel';
import type { ImportHistoryEntry } from '../types';

export type ImportHistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: ImportHistoryEntry[] };

/** One limited query (latest 20 imports). `refresh` re-queries (e.g. after an import). */
export function useImportHistory(count = 20) {
  const [state, setState] = useState<ImportHistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getImportHistory(count)
      .then((entries) => {
        if (!cancelled) setState({ status: 'ready', entries });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: toAppError(e, 'Unable to load import history.').message,
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
