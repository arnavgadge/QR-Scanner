import { useCallback, useEffect, useState } from 'react';
import { toAppError } from '../services/errors';
import { getRecentScans } from '../services/scans/scanLogService';
import type { ScanLog } from '../types';

export type RecentScansState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
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
    getRecentScans(count)
      .then((scans) => {
        if (!cancelled) setState({ status: 'ready', scans });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState((prev) =>
            prev.status === 'ready'
              ? prev // a failed background refresh keeps the rows already on screen
              : { status: 'error', message: toAppError(e, 'Unable to load recent scans.').message },
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

  return { state, reload, refresh };
}

export type RecentScansController = ReturnType<typeof useRecentScans>;
