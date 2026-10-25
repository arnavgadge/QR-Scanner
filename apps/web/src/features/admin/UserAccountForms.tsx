import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { dataService } from '../../data';
import { useI18n } from '../../hooks/useI18n';
import { msg, type Msg, type Text } from '../../i18n';
import { errorText, toAppError } from '../../services/errors';
import type { User, UserRole } from '../../types';

/**
 * Desktop only (capabilities.manageAccounts): accounts are created and passwords set in the app,
 * because there is no Firebase console. Passwords are checked and hashed by the server.
 */
export function AddUserForm({ onDone }: { onDone: (m: Msg) => void }) {
  const { t, text } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Desktop: stations scan without signing in, so new accounts are administrators.
  const adminOnly = dataService.capabilities.stationScanning;
  const [role, setRole] = useState<UserRole>(adminOnly ? 'admin' : 'operator');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<Text | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await dataService.createUser({ name, email, role, password });
      onDone(msg('users.added', { name: name.trim() }));
      setName('');
      setEmail('');
      setPassword('');
      setRole(adminOnly ? 'admin' : 'operator');
    } catch (err) {
      setError(errorText(toAppError(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label={t('users.add')}
      data-testid="user-add-form"
      className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
    >
      <TextField
        label={t('users.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={saving}
      />
      <TextField
        label={t('users.email')}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={saving}
        autoComplete="off"
      />
      {!adminOnly && (
        <div>
          <label htmlFor="new-user-role" className="block text-sm font-semibold">
            {t('users.role')}
          </label>
          <select
            id="new-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={saving}
            className="mt-1 min-h-14 w-full rounded-md border border-line bg-surface px-3 text-lg"
          >
            <option value="operator">{t('role.operator')}</option>
            <option value="admin">{t('role.admin')}</option>
          </select>
        </div>
      )}
      <TextField
        label={t('users.password')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={saving}
        autoComplete="new-password"
      />
      <Button type="submit" disabled={saving} className="min-h-14">
        {saving ? t('common.saving') : t('users.createAccount')}
      </Button>
      {error && (
        <p role="alert" className="font-semibold text-danger sm:col-span-2 lg:col-span-5">
          {text(error)}
        </p>
      )}
    </form>
  );
}

export function SetPasswordForm({
  user,
  onDone,
  onCancel,
}: {
  user: User;
  onDone: (m: Msg) => void;
  onCancel: () => void;
}) {
  const { t, text } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<Text | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await dataService.setUserPassword(user.uid, password);
      onDone(msg('users.passwordChanged', { name: user.name }));
    } catch (err) {
      setError(errorText(toAppError(err)));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-2">
      <TextField
        label={t('users.newPassword')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={saving}
        autoComplete="new-password"
        error={error ? text(error) : undefined}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? t('common.saving') : t('users.setPassword')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
