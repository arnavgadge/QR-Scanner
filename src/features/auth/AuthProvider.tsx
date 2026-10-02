import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { signInWithEmail, signOutUser, subscribeToAuth } from '../../services/firebase/auth';
import { getFirebase } from '../../services/firebase/client';
import { toAppError } from '../../services/errors';
import { getUserProfile } from '../../services/users/userService';
import { AuthContext, type AuthContextValue, type AuthState } from './AuthContext';

/**
 * The single auth listener. Flow: Firebase Auth -> uid -> users/{uid} -> role/active -> state.
 * Role and active flag always come from Firestore, never from client-side state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const seq = useRef(0); // guards against out-of-order async results

  const loadProfile = useCallback(async (uid: string) => {
    const token = ++seq.current;
    try {
      const user = await getUserProfile(uid);
      if (token !== seq.current) return;
      if (!user) setState({ status: 'no-profile' });
      else if (!user.active) setState({ status: 'inactive', user });
      else setState({ status: 'ready', user });
    } catch (e) {
      if (token !== seq.current) return;
      setState({ status: 'error', message: toAppError(e).message });
    }
  }, []);

  useEffect(() => {
    return subscribeToAuth(
      (identity) => {
        if (!identity) {
          seq.current += 1;
          setState({ status: 'unauthenticated' });
          return;
        }
        setState({ status: 'loading' });
        void loadProfile(identity.uid);
      },
      (error) => setState({ status: 'error', message: error.message }),
    );
  }, [loadProfile]);

  const retry = useCallback(() => {
    const current = getFirebase().auth.currentUser;
    if (!current) return;
    setState({ status: 'loading' });
    void loadProfile(current.uid);
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn: signInWithEmail, signOut: signOutUser, retry }),
    [state, retry],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
