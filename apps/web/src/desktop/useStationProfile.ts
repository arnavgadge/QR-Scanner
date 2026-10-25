import { useCallback, useEffect, useState } from 'react';
import { desktopBridge } from './bridge';
import type { StationProfile } from './protocol';

/**
 * This station's own profile (name, usual operator, set up or not) from the main computer.
 * Reloaded whenever the link comes online and when an administrator changes this station.
 * null while unknown (e.g. the main computer cannot be reached yet) and in the web app.
 */
export function useStationProfile(enabled = true) {
  const [profile, setProfile] = useState<StationProfile | null>(null);

  const reload = useCallback(() => {
    const bridge = desktopBridge();
    if (!bridge || !enabled) return;
    void bridge.call('hello', {}).then((r) => {
      if (r.ok) setProfile(r.data.station);
    });
  }, [enabled]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge || !enabled) return;
    reload();
    return bridge.on((e) => {
      if (e.type === 'connection' && e.state === 'online') reload();
      if (e.type === 'server' && e.event.type === 'station-changed') reload();
    });
  }, [enabled, reload]);

  return { profile, setProfile, reload };
}
