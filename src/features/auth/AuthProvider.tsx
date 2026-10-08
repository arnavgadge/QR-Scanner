import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { signInWithEmail, signOutUser, subscribeToAuth } from '../../services/firebase/auth';
import { getFirebase } from '../../services/firebase/client';
import { subscribeToUserProfile } from '../../services/users/userService';
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
    stopWatching.current = subscribeToUserProfile(
      uid,
      (user) => {
        if (token !== seq.current) return;
        if (!user) setState({ status: 'no-profile' });
        else if (!user.active) setState({ status: 'inactive', user });
        else setState({ status: 'ready', user });
      },
      (error) => {
        if (token !== seq.current) return;
        setState({ status: 'error', message: error.message });
      },
    );
  }, []);

  useEffect(() => {
    const stop = subscribeToAuth(
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
      (error) => setState({ status: 'error', message: error.message }),
    );
    return () => {
      stop();
      stopWatching.current?.();
      stopWatching.current = null;
    };
  }, [watchProfile]);

  const retry = useCallback(() => {
    const current = getFirebase().auth.currentUser;
    if (!current) return;
    setState({ status: 'loading' });
    watchProfile(current.uid);
  }, [watchProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn: signInWithEmail, signOut: signOutUser, retry }),
    [state, retry],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
