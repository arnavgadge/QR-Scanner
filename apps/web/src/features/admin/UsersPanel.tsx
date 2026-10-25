import { useCallback, useState } from 'react';
import { ErrorNotice } from '../../components/common/ErrorNotice';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { useAsyncData } from '../../hooks/useAsyncData';
import { useI18n } from '../../hooks/useI18n';
import { useUser } from '../../hooks/useUser';
import { errorText, toAppError } from '../../services/errors';
import { dataService } from '../../data';
import { checkUserChange, type UserChange } from '../../services/users/userChangeRules';
import type { User } from '../../types';
import { AddUserForm, SetPasswordForm } from './UserAccountForms';

import { msg, type MessageKey, type Text } from '../../i18n/core';
interface Pending {
  uid: string;
  change: UserChange;
  label: MessageKey;
}

/**
 * Admin: view users and change another user's role / active status. There are no credentials
 * here (passwords and tokens are never stored in Firestore or shown). An admin cannot change their
 * own account, and the last active admin cannot be demoted or deactivated.
 */
export function UsersPanel() {
  const me = useUser();
  const loader = useCallback(() => dataService.getUsers(), []);
  const { state, reload, refresh } = useAsyncData(loader, 'users.loadFailed');
  const { t, text, dateTime } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [passwordFor, setPasswordFor] = useState<string | null>(null);
  const manageAccounts = dataService.capabilities.manageAccounts;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: Text } | null>(null);

  if (state.status === 'loading') return <LoadingState label={t('users.loading')} />;
  if (state.status === 'error') return <ErrorNotice message={state.message} onRetry={reload} />;
  const users = state.data;
  const activeAdmins = users.filter((u) => u.role === 'admin' && u.active).length;

  const ask = (target: User, change: UserChange, label: MessageKey) => {
    setMessage(null);
    const check = checkUserChange({ actorUid: me.uid, target, change, users });
    if (!check.ok) {
      setPending(null);
      setMessage({ tone: 'error', text: check.msg });
      return;
    }
    setPending({ uid: target.uid, change, label });
  };

  const confirm = async (target: User) => {
    if (!pending) return;
    setBusy(true);
    try {
      await dataService.changeUser({ target, change: pending.change, users });
      setMessage({
        tone: 'ok',
        text: msg('users.done', { name: target.name, action: msg(pending.label) }),
      });
      setPending(null);
      refresh();
    } catch (e) {
      setMessage({ tone: 'error', text: errorText(toAppError(e, msg('users.saveFailed'))) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* About Firebase accounts (console-managed); the desktop manages accounts right here. */}
      {!manageAccounts && (
        <p
          className="max-w-3xl rounded-md bg-info-soft px-3 py-2 text-sm text-info"
          data-testid="users-note"
        >
          {t('users.note')}
        </p>
      )}
      {manageAccounts && (
        <AddUserForm
          onDone={(m) => {
            setMessage({ tone: 'ok', text: m });
            refresh();
          }}
        />
      )}
      <div aria-live="polite">
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            data-testid="users-message"
            className={`rounded-md p-3 font-semibold ${message.tone === 'ok' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
          >
            {text(message.text)}
          </p>
        )}
      </div>

      {users.length === 0 ? (
        <p className="text-ink-muted" data-testid="users-empty">
          {t('users.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-left" data-testid="users-table">
            <thead className="bg-info-soft text-sm">
              <tr>
                {[
                  t('users.name'),
                  t('users.email'),
                  t('users.role'),
                  t('common.status'),
                  t('users.created'),
                  t('common.lastChanged'),
                  '',
                ].map((h, i) => (
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
                        <span className="ml-1 text-sm font-normal text-ink-muted">
                          {t('users.you')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm break-all">{u.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-sm font-bold ${u.role === 'admin' ? 'bg-action-soft text-action' : 'bg-info-soft text-info'}`}
                      >
                        {u.role === 'admin' ? t('role.admin') : t('role.operator')}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          u.active ? 'font-semibold text-success' : 'font-semibold text-danger'
                        }
                      >
                        {u.active ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm whitespace-nowrap">{dateTime(u.createdAt)}</td>
                    <td className="px-3 py-2 text-sm">
                      {u.updatedAt ? dateTime(u.updatedAt) : '—'}
                      {u.updatedByName && (
                        <span className="block text-ink-muted">
                          {t('common.by', { name: u.updatedByName })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isMe ? (
                        <span className="text-sm text-ink-muted">{t('users.ownAccount')}</span>
                      ) : passwordFor === u.uid ? (
                        <SetPasswordForm
                          user={u}
                          onCancel={() => setPasswordFor(null)}
                          onDone={(m) => {
                            setPasswordFor(null);
                            setMessage({ tone: 'ok', text: m });
                          }}
                        />
                      ) : isPending ? (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold">
                            {t('users.confirm', { action: msg(pending.label) })}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => void confirm(u)}
                              disabled={busy}
                              data-testid={`user-confirm-${u.uid}`}
                            >
                              {busy ? t('common.saving') : t('common.yes')}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setPending(null)}
                              disabled={busy}
                            >
                              {t('common.no')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {manageAccounts && (
                            <Button
                              variant="secondary"
                              data-testid={`user-password-${u.uid}`}
                              onClick={() => {
                                setPending(null);
                                setPasswordFor(u.uid);
                              }}
                            >
                              {t('users.setPassword')}
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            data-testid={`user-role-${u.uid}`}
                            onClick={() =>
                              ask(
                                u,
                                { role: u.role === 'admin' ? 'operator' : 'admin' },
                                u.role === 'admin' ? 'users.toOperator' : 'users.toAdmin',
                              )
                            }
                          >
                            {u.role === 'admin' ? t('users.makeOperator') : t('users.makeAdmin')}
                          </Button>
                          <Button
                            variant={u.active ? 'secondary' : 'primary'}
                            data-testid={`user-active-${u.uid}`}
                            onClick={() =>
                              ask(
                                u,
                                { active: !u.active },
                                u.active ? 'users.deactivateAction' : 'users.reactivateAction',
                              )
                            }
                          >
                            {u.active ? t('users.deactivate') : t('users.reactivate')}
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
        {t('users.summary', { users: users.length, admins: activeAdmins })}
      </p>
    </div>
  );
}
