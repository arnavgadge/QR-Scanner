import { useCallback, useEffect, useState } from 'react';
import { msg, type MessageKey, type Text } from '../i18n/core';
import { errorText, toAppError } from '../services/errors';

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; message: Text } | { status: 'ready'; data: T };

/**
 * Loads data once and exposes explicit loading / error / ready states, so a page never shows an
 * "empty" message before the data has actually arrived. `loader` must be stable (useCallback).
 * `reload` shows the loading state again; `refresh` re-fetches and keeps the current data visible.
 * `fallbackKey` is a message KEY (a string), so it stays stable across renders.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  fallbackKey: MessageKey = 'errors.loadData',
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
              : { status: 'error', message: errorText(toAppError(e, msg(fallbackKey))) },
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loader, attempt, fallbackKey]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, reload, refresh };
}
