import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useI18n } from '../../hooks/useI18n';
import { msg, type Text } from '../../i18n';
import { errorText, toAppError } from '../../services/errors';
import { desktopBridge, type DesktopInfo } from '../bridge';
import { desktopCall } from '../call';
import { RecoveryCodeNotice } from '../RecoveryCodeNotice';

const MIN_PASSWORD = 8;

/**
 * Forgotten admin password: the recovery code sets a new one. Only on the main computer itself
 * (on the backup, the promotion screen accepts the code too).
 */
export default function RecoverPage() {
  const { t, text } = useI18n();
  const navigate = useNavigate();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<Text | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  useEffect(() => {
    void desktopBridge()?.info().then(setInfo);
  }, []);

  if (newCode) {
    return (
      <RecoveryCodeNotice code={newCode} onDone={() => navigate('/login', { replace: true })} />
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      return setError(msg('users.passwordTooShort', { min: MIN_PASSWORD }));
    }
    if (password !== again) return setError(msg('recovery.mismatch'));
    setBusy(true);
    setError(null);
    try {
      const r = await desktopCall('auth.recover', { email, code, newPassword: password });
      setNewCode(r.recoveryCode);
    } catch (err) {
      setError(errorText(toAppError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="recover-title" className="space-y-4">
      <h1 id="recover-title" className="text-2xl font-bold">
        {t('recovery.resetTitle')}
      </h1>
      {info && info.role !== 'main' ? (
        <p className="rounded-md bg-info-soft p-3">
          {t(info.role === 'backup' ? 'recovery.onBackup' : 'recovery.onStation')}
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
          <p className="text-ink-muted">{t('recovery.resetHelp')}</p>
          <TextField
            label={t('login.email')}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <TextField
            label={t('recovery.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
            disabled={busy}
          />
          <TextField
            label={t('recovery.newPassword')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <TextField
            label={t('recovery.newPasswordAgain')}
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
              {text(error)}
            </p>
          )}
          <Button type="submit" disabled={busy} className="min-h-14 w-full text-lg">
            {busy ? t('common.saving') : t('recovery.reset')}
          </Button>
        </form>
      )}
      <Link to="/login" className="inline-flex min-h-touch items-center underline">
        {t('recovery.backToSignIn')}
      </Link>
    </section>
  );
}
