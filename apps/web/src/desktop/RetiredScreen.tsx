import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/TextField';
import { useI18n } from '../hooks/useI18n';
import type { Text } from '../i18n';
import { desktopBridge } from './bridge';
import type { HandoverResult } from './protocol';

/**
 * A former main computer (a backup was made the main computer). It never registers again. An
 * administrator confirms with their password: what the new main computer may be missing is sent
 * there, then this computer becomes a station (same pairing, nothing to set up).
 */
export function RetiredScreen() {
  const { t, text, number } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Text | null>(null);
  const [done, setDone] = useState<HandoverResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await desktopBridge()!.handover({ email, password });
    setBusy(false);
    if (r.ok) setDone(r.data);
    else setError(r.error.msg ?? r.error.message);
  };

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-8" data-testid="retired-screen">
      <h1 className="text-2xl font-bold text-danger sm:text-3xl">{t('retired.title')}</h1>
      <p>{t('retired.explain')}</p>
      {done ? (
        <section className="space-y-3 rounded-lg border-2 border-success bg-success-soft p-5">
          <p className="font-bold">{t('retired.doneTitle')}</p>
          <ul className="list-disc pl-6">
            <li>{t('retired.added', { count: number(done.serialsAdded) })}</li>
            <li>{t('retired.same', { count: number(done.serialsSame) })}</li>
            {done.conflicts > 0 && (
              <li className="font-semibold text-danger">
                {t('retired.conflicts', { count: number(done.conflicts) })}
              </li>
            )}
          </ul>
          <Button onClick={() => window.location.reload()} className="min-h-14 w-full text-lg">
            {t('retired.continue')}
          </Button>
        </section>
      ) : (
        <form
          onSubmit={(e) => void submit(e)}
          noValidate
          className="space-y-4 rounded-lg border border-line bg-surface p-5"
        >
          <p className="font-semibold">{t('retired.next')}</p>
          <TextField
            label={t('login.email')}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <TextField
            label={t('promote.adminPassword')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
              {text(error)}
            </p>
          )}
          <Button type="submit" disabled={busy} className="min-h-14 w-full text-lg">
            {busy ? t('retired.working') : t('retired.button')}
          </Button>
        </form>
      )}
    </main>
  );
}
