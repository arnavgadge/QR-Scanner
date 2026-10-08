import { useCallback, useState } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useUser } from '../../hooks/useUser';
import { toAppError } from '../../services/errors';
import { currentAdmin } from '../../services/users/currentAdmin';
import {
  applyUserChange,
  checkUserChange,
  getAllUsers,
  type UserChange,
} from '../../services/users/userAdminService';
import type { User } from '../../types';
import { formatDateTime } from '../../utils/format';

interface Pending {
  uid: string;
  change: UserChange;
  label: string;
}

/**
 * Admin: view users and change another user's role / active status. There are no credentials
 * here (passwords and tokens are never stored in Firestore or shown). An admin cannot change their
 * own account, and the last active admin cannot be demoted or deactivated.
 */
export function UsersPanel() {
  const me = useUser();
  const loader = useCallback(() => getAllUsers(), []);
  const { state, reload, refresh } = useAsyncData(loader, 'Unable to load users.');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (state.status === 'loading') return <LoadingState label="Loading users…" />;
  if (state.status === 'error') return <ErrorNotice message={state.message} onRetry={reload} />;
  const users = state.data;
  const activeAdmins = users.filter((u) => u.role === 'admin' && u.active).length;

  const ask = (target: User, change: UserChange, label: string) => {
    setMessage(null);
    const check = checkUserChange({ actorUid: me.uid, target, change, users });
    if (!check.ok) {
      setPending(null);
      setMessage({ tone: 'error', text: check.message });
      return;
    }
    setPending({ uid: target.uid, change, label });
  };

  const confirm = async (target: User) => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyUserChange({ target, change: pending.change, users }, await currentAdmin());
      setMessage({ tone: 'ok', text: `${target.name}: ${pending.label}.` });
      setPending(null);
      refresh();
    } catch (e) {
      setMessage({ tone: 'error', text: toAppError(e, 'Unable to save the change.').message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p
        className="max-w-3xl rounded-md bg-info-soft px-3 py-2 text-sm text-info"
        data-testid="users-note"
      >
        Deactivating a user blocks all access to the application&rsquo;s data immediately. It does
        not disable their Firebase sign-in account (that needs the Firebase console or Admin SDK);
        they can still sign in but will only see &ldquo;account inactive&rdquo;. You cannot change
        your own account, and the last active administrator cannot be removed. New accounts are
        created in the Firebase console; no passwords are ever shown here.
      </p>
      <div aria-live="polite">
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            data-testid="users-message"
            className={`rounded-md p-3 font-semibold ${message.tone === 'ok' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
          >
            {message.text}
          </p>
        )}
      </div>

      {users.length === 0 ? (
        <p className="text-ink-muted" data-testid="users-empty">
          No users yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left" data-testid="users-table">
            <thead className="bg-info-soft text-sm">
              <tr>
                {['Name', 'Email', 'Role', 'Status', 'Created', 'Last changed', ''].map((h, i) => (
                  <th key={h || i} scope="col" className="px-3 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.uid === me.uid;
                const isPending = pending?.uid === u.uid;
                return (
                  <tr
                    key={u.uid}
                    data-testid={`user-row-${u.uid}`}
                    className={`border-t border-line align-top ${u.active ? '' : 'bg-surface-muted text-ink-muted'}`}
                  >
                    <td className="px-3 py-2 font-semibold">
                      {u.name}
                      {isMe && (
                        <span className="ml-1 text-sm font-normal text-ink-muted">(you)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm break-all">{u.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-sm font-bold ${u.role === 'admin' ? 'bg-action-soft text-action' : 'bg-info-soft text-info'}`}
                      >
                        {u.role === 'admin' ? 'Admin' : 'Operator'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          u.active ? 'font-semibold text-success' : 'font-semibold text-danger'
                        }
                      >
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm whitespace-nowrap">
                      {formatDateTime(u.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {u.updatedAt ? formatDateTime(u.updatedAt) : '—'}
                      {u.updatedByName && (
                        <span className="block text-ink-muted">by {u.updatedByName}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isMe ? (
                        <span className="text-sm text-ink-muted">Your own account</span>
                      ) : isPending ? (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold">Confirm: {pending.label}?</p>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => void confirm(u)}
                              disabled={busy}
                              data-testid={`user-confirm-${u.uid}`}
                            >
                              {busy ? 'Saving…' : 'Yes'}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setPending(null)}
                              disabled={busy}
                            >
                              No
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            data-testid={`user-role-${u.uid}`}
                            onClick={() =>
                              ask(
                                u,
                                { role: u.role === 'admin' ? 'operator' : 'admin' },
                                u.role === 'admin'
                                  ? 'change role to Operator'
                                  : 'change role to Admin',
                              )
                            }
                          >
                            {u.role === 'admin' ? 'Make operator' : 'Make admin'}
                          </Button>
                          <Button
                            variant={u.active ? 'secondary' : 'primary'}
                            data-testid={`user-active-${u.uid}`}
                            onClick={() =>
                              ask(
                                u,
                                { active: !u.active },
                                u.active ? 'deactivate this user' : 'reactivate this user',
                              )
                            }
                          >
                            {u.active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-ink-muted" data-testid="users-summary">
        {users.length} user{users.length === 1 ? '' : 's'} · {activeAdmins} active administrator
        {activeAdmins === 1 ? '' : 's'}
      </p>
    </div>
  );
}
