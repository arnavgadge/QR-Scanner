import { useCallback, useEffect, useRef, useState } from 'react';
import { dataService, type HistoryCursor, type ScanHistoryFilters } from '../../data';
import { errorText, toAppError } from '../../services/errors';
import type { ScanLog } from '../../types';

import { msg, type Text } from '../../i18n/core';
export type ScanHistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: Text }
  | {
      status: 'ready';
      entries: ScanLog[];
      partNumbers: Map<string, string>;
      hasMore: boolean;
      loadingMore: boolean;
      moreError: Text | null;
    };

/**
 * Cursor-paginated scan history. Changing the filters starts again from the first page; "load
 * more" appends the next page. Only one page is fetched at a time (never the whole collection).
 * `filtersKey` must change exactly when `filters` does (a primitive, so the effect is stable).
 */
export function useScanHistory(filters: ScanHistoryFilters, filtersKey: string, enabled = true) {
  const [state, setState] = useState<ScanHistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const cursor = useRef<HistoryCursor | null>(null);
  const run = useRef(0); // ignores results of superseded requests
  const latest = useRef(filters);

  useEffect(() => {
    latest.current = filters;
  });

  useEffect(() => {
    if (!enabled) return;
    const id = ++run.current;
    cursor.current = null;
    setState({ status: 'loading' });
    dataService
      .getScanHistoryPage(latest.current)
      .then((page) => {
        if (id !== run.current) return;
        cursor.current = page.cursor;
        setState({
          status: 'ready',
          entries: page.entries,
          partNumbers: page.partNumbers,
          hasMore: page.hasMore,
          loadingMore: false,
          moreError: null,
        });
      })
      .catch((e: unknown) => {
        if (id === run.current) {
          setState({
            status: 'error',
            message: errorText(toAppError(e, msg('scanHistory.loadFailed'))),
          });
        }
      });
  }, [filtersKey, attempt, enabled]);

  const loadMore = useCallback(async () => {
    const id = run.current;
    const from = cursor.current;
    if (!from) return;
    setState((s) => (s.status === 'ready' ? { ...s, loadingMore: true, moreError: null } : s));
    try {
      const page = await dataService.getScanHistoryPage(latest.current, from);
      if (id !== run.current) return;
      cursor.current = page.cursor;
      setState((s) =>
        s.status === 'ready'
          ? {
              status: 'ready',
              entries: [...s.entries, ...page.entries],
              partNumbers: new Map([...s.partNumbers, ...page.partNumbers]),
              hasMore: page.hasMore,
              loadingMore: false,
              moreError: null,
            }
          : s,
      );
    } catch (e) {
      if (id !== run.current) return;
      setState((s) =>
        s.status === 'ready'
          ? {
              ...s,
              loadingMore: false,
              moreError: errorText(toAppError(e, msg('scanHistory.loadMoreFailed'))),
            }
          : s,
      );
    }
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, loadMore, reload };
}
