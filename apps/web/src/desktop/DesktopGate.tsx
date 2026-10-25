import { useEffect, useState, type ReactNode } from 'react';
import { LoadingState } from '../components/common/LoadingState';
import { desktopBridge, type DesktopInfo } from './bridge';
import { RetiredScreen } from './RetiredScreen';
import { DesktopSetup } from './setup/DesktopSetup';
import { StationProfileSetup } from './setup/StationProfileSetup';
import { useStationProfile } from './useStationProfile';

/**
 * Desktop app, before the scan screen: first-run setup (main computer or station), then the
 * one-time station setup (name, usual operator). After that the app opens straight to scanning,
 * now and after every restart; nobody signs in to scan.
 */
export default function DesktopGate({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    const read = () => void bridge.info().then(setInfo);
    read();
    // Promotion, a backup role, or this main computer being replaced.
    return bridge.on((e) => {
      if (e.type === 'cluster') read();
    });
  }, []);
  const { profile, setProfile } = useStationProfile(!!info?.mode);

  if (!info) return <LoadingState />;
  if (!info.mode) return <DesktopSetup />;
  if (info.role === 'retired') return <RetiredScreen />;
  // Profile unknown (main computer not reachable yet): open the app; its banner explains.
  if (profile && !profile.configured) {
    return <StationProfileSetup profile={profile} onDone={setProfile} />;
  }
  return <>{children}</>;
}
