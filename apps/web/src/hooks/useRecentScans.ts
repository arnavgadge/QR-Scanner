import { useCallback, useEffect, useState } from 'react';
import { errorText, toAppError } from '../services/errors';
import { dataService } from '../data';
import type { ScanLog } from '../types';

import { msg, type Text } from '../i18n/core';
export type RecentScansState =
  | { status: 'loading' }
  | { status: 'error'; message: Text }
  | { status: 'ready'; scans: ScanLog[] };

/**
 * One limited query on mount. `reload` shows the loading state (for retry); `refresh` re-queries
 * silently, keeping the current rows visible (after a scan). No real-time listener (deliberate).
 */
export function useRecentScans(count = 20) {
  const [state, setState] = useState<RecentScansState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    dataService
      .getRecentScans(count)
      .then((scans) => {
        if (!cancelled) setState({ status: 'ready', scans });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState((prev) =>
            prev.status === 'ready'
              ? prev // a failed background refresh keeps the rows already on screen
              : { status: 'error', message: errorText(toAppError(e, msg('recent.loadFailed'))) },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [count, attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  // Desktop: a scan registered on ANY station is pushed live, so every history strip matches.
  useEffect(() => dataService.onScansChanged(refresh), [refresh]);

  return { state, reload, refresh };
}

export type RecentScansController = ReturnType<typeof useRecentScans>;
