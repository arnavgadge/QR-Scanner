import { useCallback, useEffect, useState } from 'react';
import { toAppError } from '../services/errors';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/**
 * Loads data once and exposes explicit loading / error / ready states, so a page never shows an
 * "empty" message before the data has actually arrived. `loader` must be stable (useCallback).
 * `reload` shows the loading state again; `refresh` re-fetches and keeps the current data visible.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  fallbackMessage = 'Unable to load data.',
) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState((prev) =>
            prev.status === 'ready' && attempt > 0
              ? prev // a failed background refresh keeps the data already on screen
              : { status: 'error', message: toAppError(e, fallbackMessage).message },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loader, attempt, fallbackMessage]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, reload, refresh };
}
