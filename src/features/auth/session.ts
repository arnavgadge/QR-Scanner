import type { User } from '../../types';

/**
 * Auth boundary. Phase 0: no real authentication. Phase 2 replaces this hook's body with
 * Firebase Authentication state; guards and routes should not need to change.
 */
export interface Session {
  status: 'authenticated' | 'unauthenticated' | 'loading';
  user: User | null;
}

export function useSession(): Session {
  // Phase 0 placeholder: treated as unauthenticated-but-unenforced (see guards).
  return { status: 'unauthenticated', user: null };
}

/** Phase 0 only: guards let everyone through. Phase 2 sets this to false. */
export const PHASE0_BYPASS_GUARDS = true;
