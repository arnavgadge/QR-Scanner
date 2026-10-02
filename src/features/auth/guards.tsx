import { Navigate, Outlet } from 'react-router-dom';
import { AccessDenied } from '../../components/common/AccessDenied';
import { LoadingState } from '../../components/common/LoadingState';
import { useAuth } from '../../hooks/useAuth';
import { AccountStatus } from './AccountStatus';

/*
 * Route guards. These are UX only: real authorization is enforced by Firestore Security
 * Rules (firestore.rules). A guard that renders nothing sensitive is not a substitute for them.
 */

/** Any signed-in, configured, active user (operator or admin). */
export function RequireAuth() {
  const auth = useAuth();
  switch (auth.status) {
    case 'loading':
      return <LoadingState label="Checking your session…" />;
    case 'unauthenticated':
      return <Navigate to="/login" replace />;
    case 'ready':
      return <Outlet />;
    default:
      return <AccountStatus />;
  }
}

/** Admin only. Must be nested inside RequireAuth. */
export function RequireAdmin() {
  const auth = useAuth();
  if (auth.status === 'ready' && auth.user.role === 'admin') return <Outlet />;
  return <AccessDenied />;
}
