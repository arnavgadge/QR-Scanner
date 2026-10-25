import { Link, NavLink, Outlet } from 'react-router-dom';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { UserMenu } from '../features/auth';
import { DisplayControls } from '../features/preferences';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../hooks/useI18n';
import { dataService } from '../data';
import { useStationProfile } from '../desktop/useStationProfile';
import { recordedBy } from '../features/stations/recordedBy';

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-touch items-center rounded-md px-4 font-semibold ${
    isActive ? 'bg-action text-on-accent' : 'text-ink hover:bg-action-soft'
  }`;

export function OperatorLayout() {
  const auth = useAuth();
  const { t } = useI18n();
  // Desktop: the Admin link is always there (it asks an administrator to sign in); web: admins only.
  const stationScanning = dataService.capabilities.stationScanning;
  const isAdmin = stationScanning || (auth.status === 'ready' && auth.user.role === 'admin');
  const { profile } = useStationProfile(stationScanning);
  return (
    <div className="min-h-screen">
      <ConnectionBanner />
      <header className="border-b border-line bg-surface">
        {/* Three groups with even spacing: brand | page links | display controls · account. */}
        <nav
          aria-label={t('nav.operator')}
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2"
        >
          <span className="font-bold whitespace-nowrap">
            {t('app.brand')}
            {profile && (
              <span className="ml-2 font-semibold text-ink-muted" data-testid="station-identity">
                · {recordedBy(t, profile.name, profile.operatorName)}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <NavLink to="/" end className={link}>
              {t('nav.scan')}
            </NavLink>
            <NavLink to="/history" className={link}>
              {t('nav.recentScans')}
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={link}>
                {t('nav.admin')}
              </NavLink>
            )}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <DisplayControls />
            {import.meta.env.MODE === 'desktop' && (
              <Link
                to="/station"
                className="inline-flex min-h-touch items-center rounded-md px-3 font-semibold text-ink underline hover:bg-action-soft"
                data-testid="this-computer-link"
              >
                {t('nav.thisComputer')}
              </Link>
            )}
            <span aria-hidden="true" className="h-8 w-px bg-line" />
            <UserMenu />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
