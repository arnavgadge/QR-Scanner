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
import type { User, UserRole } from '../../types';

import { logWarn } from '../../utils/log';
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
    throw toAppError(e, 'Unable to load users.');
  }
}

export interface UserChange {
  role?: UserRole;
  active?: boolean;
}

export type UserChangeCheck = { ok: true } | { ok: false; message: string };

/**
 * Admin self-protection (UI side). The Firestore rules enforce the same constraints
 * independently:
 *  - an admin cannot change their OWN role or active flag, so every change to an admin is made by
 *    a different, still-active admin, who therefore remains: the system can never end up with
 *    zero active admins through this screen;
 *  - and, for stale lists, the last active admin can never be demoted or deactivated.
 */
export function checkUserChange(input: {
  actorUid: string;
  target: User;
  change: UserChange;
  users: User[];
}): UserChangeCheck {
  const { actorUid, target, change, users } = input;
  const nextRole = change.role ?? target.role;
  const nextActive = change.active ?? target.active;
  if (nextRole === target.role && nextActive === target.active) {
    return { ok: false, message: 'Nothing to change.' };
  }
  if (target.uid === actorUid) {
    return {
      ok: false,
      message: 'You cannot change your own role or active status. Ask another administrator.',
    };
  }
  const losesAdminAccess =
    target.role === 'admin' && target.active && (nextRole !== 'admin' || !nextActive);
  if (losesAdminAccess) {
    const otherActiveAdmins = users.filter(
      (u) => u.uid !== target.uid && u.role === 'admin' && u.active,
    );
    if (otherActiveAdmins.length === 0) {
      return {
        ok: false,
        message:
          'This is the last active administrator. At least one active administrator must remain.',
      };
    }
  }
  return { ok: true };
}

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
  if (!check.ok) throw new AppError('invalid-data', check.message);
  try {
    await updateDoc(doc(db, COLLECTIONS.users, input.target.uid), {
      ...(input.change.role !== undefined ? { role: input.change.role } : {}),
      ...(input.change.active !== undefined ? { active: input.change.active } : {}),
      updated_at: serverTimestamp(),
      updated_by: actor.uid,
      updated_by_name: actor.name,
    });
  } catch (e) {
    throw toAppError(e, 'Unable to save the change.');
  }
}
