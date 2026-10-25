import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { dataService } from '../../data';
import { AccessDenied } from '../../components/common/AccessDenied';
import { LoadingState } from '../../components/common/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../hooks/useI18n';
import { AccountStatus } from './AccountStatus';

/*
 * Route guards. These are UX only: real authorization is enforced by Firestore Security
 * Rules (firestore.rules). A guard that renders nothing sensitive is not a substitute for them.
 */

/** Any signed-in, configured, active user (operator or admin). */
export function RequireAuth() {
  const auth = useAuth();
  const { t } = useI18n();
  switch (auth.status) {
    case 'loading':
      return <LoadingState label={t('common.checkingSession')} />;
    case 'unauthenticated':
      return <Navigate to="/login" replace />;
    case 'ready':
      return <Outlet />;
    default:
      return <AccountStatus />;
  }
}

/**
 * The scanning screens. Web app: a signed-in, active user (RequireAuth). Desktop: a paired station
 * scans without anyone signing in (the station is the identity), so they always open.
 */
export function RequireStationOrAuth() {
  if (dataService.capabilities.stationScanning) return <Outlet />;
  return <RequireAuth />;
}

/**
 * Admin only. Web: nested inside RequireAuth. Desktop: without an administrator sign-in, the
 * admin pages go to the sign-in screen and come back after signing in.
 */
export function RequireAdmin() {
  const auth = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (auth.status === 'ready' && auth.user.role === 'admin') return <Outlet />;
  if (dataService.capabilities.stationScanning) {
    if (auth.status === 'loading') return <LoadingState label={t('common.checkingSession')} />;
    if (auth.status !== 'ready') {
      return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    }
  }
  return <AccessDenied />;
}
