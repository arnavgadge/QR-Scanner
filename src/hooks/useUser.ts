import type { User } from '../types';
import { useAuth } from './useAuth';

/** The signed-in, active user's profile. Only call inside routes protected by RequireAuth. */
export function useUser(): User {
  const auth = useAuth();
  if (auth.status !== 'ready') throw new Error('useUser requires an authenticated, active user');
  return auth.user;
}
