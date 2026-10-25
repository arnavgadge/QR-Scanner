import type { Text } from '../../i18n/core';
import { createContext } from 'react';
import type { User } from '../../types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  /** Signed in with Firebase but no users/{uid} document. */
  | { status: 'no-profile' }
  | { status: 'inactive'; user: User }
  /** Profile could not be loaded (network, permissions, malformed data). */
  | { status: 'error'; message: Text }
  | { status: 'ready'; user: User };

export type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-attempts loading the profile after an 'error' state. */
  retry: () => void;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
