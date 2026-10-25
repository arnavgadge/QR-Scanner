import { useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { usePreferences } from '../../hooks/usePreferences';

/**
 * Connects display preferences to the signed-in account. On each sign-in the account's saved
 * language/theme (if any) is applied once; after that the person's own changes win and are saved
 * back (a later echo of the profile document never overrides a newer local choice).
 */
export function AccountPreferencesSync() {
  const auth = useAuth();
  const { bindAccount } = usePreferences();
  const uid = auth.status === 'ready' ? auth.user.uid : null;
  const saved = auth.status === 'ready' ? auth.user.preferences : undefined;
  const boundUid = useRef<string | null>(null);

  useEffect(() => {
    if (uid === boundUid.current) return;
    boundUid.current = uid;
    bindAccount(uid, saved);
  }, [uid, saved, bindAccount]);

  return null;
}
