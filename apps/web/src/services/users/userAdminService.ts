import {
  collection,
  doc,
  getDocsFromServer,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { COLLECTIONS, getDb } from '../firebase/firestore';
import { parseUser } from '../firebase/converters';
import { AppError, toAppError } from '../errors';
import type { AdminActor } from './currentAdmin';
import type { User } from '../../types';

import { logWarn } from '../../utils/log';
import { msg } from '../../i18n/core';
import { checkUserChange, type UserChange } from './userChangeRules';
/** Admin: every user profile (name, email, role, active, timestamps; no credentials exist here). */
export async function getAllUsers(db: Firestore = getDb()): Promise<User[]> {
  try {
    const snap = await getDocsFromServer(collection(db, COLLECTIONS.users));
    const users: User[] = [];
    for (const d of snap.docs) {
      try {
        users.push(parseUser(d.id, d.data()));
      } catch (e) {
        logWarn('Skipping malformed user document', d.id, e);
      }
    }
    return users.sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  } catch (e) {
    throw toAppError(e, msg('users.loadFailed'));
  }
}

export { checkUserChange, type UserChange, type UserChangeCheck } from './userChangeRules';

/**
 * Admin: changes another user's role and/or active flag. Only these fields change, attributed to
 * the acting admin. NOTE: `active: false` blocks all access to application data (the Firestore
 * rules require an active profile) but does NOT disable the person's Firebase Authentication
 * account: that needs the Firebase Admin SDK / console, which this client-only app does not have.
 */
export async function applyUserChange(
  input: { target: User; change: UserChange; users: User[] },
  actor: AdminActor,
  db: Firestore = getDb(),
): Promise<void> {
  const check = checkUserChange({ actorUid: actor.uid, ...input });
  if (!check.ok) throw new AppError('invalid-data', check.msg);
  try {
    await updateDoc(doc(db, COLLECTIONS.users, input.target.uid), {
      ...(input.change.role !== undefined ? { role: input.change.role } : {}),
      ...(input.change.active !== undefined ? { active: input.change.active } : {}),
      updated_at: serverTimestamp(),
      updated_by: actor.uid,
      updated_by_name: actor.name,
    });
  } catch (e) {
    throw toAppError(e, msg('users.saveFailed'));
  }
}
