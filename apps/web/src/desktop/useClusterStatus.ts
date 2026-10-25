import { useCallback, useEffect } from 'react';
import { useAsyncData } from '../hooks/useAsyncData';
import { desktopBridge } from './bridge';
import { desktopCall } from './call';

/** Re-reads whenever the system changes (backup online/offline, promotion) and every 10 s. */
export function useClusterStatus() {
  const loader = useCallback(() => desktopCall('cluster.status', {}), []);
  const status = useAsyncData(loader, 'backup.loadFailed');
  const { refresh } = status;
  useEffect(() => {
    const off = desktopBridge()?.on((e) => {
      if (
        e.type === 'cluster' ||
        (e.type === 'server' &&
          (e.event.type === 'cluster-changed' || e.event.type === 'backup-progress'))
      ) {
        refresh();
      }
    });
    const timer = setInterval(refresh, 10_000);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, [refresh]);
  return status;
}
