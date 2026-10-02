import { Navigate, Outlet } from 'react-router-dom';
import { PHASE0_BYPASS_GUARDS, useSession } from './session';

/*
 * Route guards. Frontend guards are UX only; real authorization is enforced by
 * Firestore Security Rules (Phase 2).
 */

export function RequireAuth() {
  const { status } = useSession();
  if (PHASE0_BYPASS_GUARDS || status === 'authenticated') return <Outlet />;
  if (status === 'loading') return null;
  return <Navigate to="/login" replace />;
}

export function RequireOperator() {
  const { user } = useSession();
  if (PHASE0_BYPASS_GUARDS || user?.role === 'operator' || user?.role === 'admin') {
    return <Outlet />;
  }
  return <Navigate to="/login" replace />;
}

export function RequireAdmin() {
  const { user } = useSession();
  if (PHASE0_BYPASS_GUARDS || user?.role === 'admin') return <Outlet />;
  return <Navigate to="/" replace />;
}
