import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dataService } from '../../data';
import { errorText } from '../../services/errors';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';

/**
 * The single auth listener. Flow: Firebase Auth -> uid -> users/{uid} -> role/active -> state.
 * Role and active flag always come from Firestore, never from client-side state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const seq = useRef(0); // guards against out-of-order async results

  const stopWatching = useRef<(() => void) | null>(null);

  /**
   * Watches users/{uid} for as long as the person is signed in, so role/active changes made by an
   * admin apply to the open session at once (the rules enforce them regardless).
   */
  const watchProfile = useCallback((uid: string) => {
    stopWatching.current?.();
    const token = ++seq.current;
    stopWatching.current = dataService.watchOwnProfile(
      uid,
      (user) => {
        if (token !== seq.current) return;
        if (!user) setState({ status: 'no-profile' });
        else if (!user.active) setState({ status: 'inactive', user });
        else setState({ status: 'ready', user });
      },
      (error) => {
        if (token !== seq.current) return;
        setState({ status: 'error', message: errorText(error) });
      },
    );
  }, []);

  useEffect(() => {
    const stop = dataService.onAuthChange(
      (identity) => {
        if (!identity) {
          seq.current += 1;
          stopWatching.current?.();
          stopWatching.current = null;
          setState({ status: 'unauthenticated' });
          return;
        }
        setState({ status: 'loading' });
        watchProfile(identity.uid);
      },
      (error) => setState({ status: 'error', message: errorText(error) }),
    );
    return () => {
      stop();
      stopWatching.current?.();
      stopWatching.current = null;
    };
  }, [watchProfile]);

  const retry = useCallback(() => {
    const uid = dataService.currentUserId();
    if (!uid) return;
    setState({ status: 'loading' });
    watchProfile(uid);
  }, [watchProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn: dataService.login, signOut: dataService.logout, retry }),
    [state, retry],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
