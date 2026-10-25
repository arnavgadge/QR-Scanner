import { enText, msg, type Msg } from '../../i18n/core';
import type { User, UserRole } from '../../types';

/*
 * Pure rules for admin changes to user accounts (no database access), shared by the admin UI
 * (to refuse early, with a clear message) and every backend (which enforces them again).
 */

export interface UserChange {
  role?: UserRole;
  active?: boolean;
}

/** A refused change: `message` is English (logs, tests), `msg` is shown translated. */
export type UserChangeCheck = { ok: true } | { ok: false; message: string; msg: Msg };

const refuse = (m: Msg): UserChangeCheck => ({ ok: false, message: enText(m), msg: m });

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
    return refuse(msg('users.nothingToChange'));
  }
  if (target.uid === actorUid) {
    return refuse(msg('users.cannotChangeSelf'));
  }
  const losesAdminAccess =
    target.role === 'admin' && target.active && (nextRole !== 'admin' || !nextActive);
  if (losesAdminAccess) {
    const otherActiveAdmins = users.filter(
      (u) => u.uid !== target.uid && u.role === 'admin' && u.active,
    );
    if (otherActiveAdmins.length === 0) {
      return refuse(msg('users.lastAdmin'));
    }
  }
  return { ok: true };
}
