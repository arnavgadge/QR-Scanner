import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useI18n } from '../../hooks/useI18n';
import { isMsg, type Text } from '../../i18n';
import { desktopBridge, type DesktopInfo } from '../bridge';
import { RecoveryCodeNotice } from '../RecoveryCodeNotice';

/**
 * On the backup main computer: "Make this the main computer". One screen for a non-technical
 * administrator: what will happen, how current this copy is, and the administrator's password
 * (or the recovery code if the password is forgotten).
 */
export default function PromotePage() {
  const { t, text, dateTime } = useI18n();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [mustTick, setMustTick] = useState(false);
  const [error, setError] = useState<Text | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    const read = () => void bridge.info().then(setInfo);
    read();
    return bridge.on((e) => {
      if (e.type === 'cluster' || e.type === 'connection') read();
    });
  }, []);

  if (newCode) {
    return <RecoveryCodeNotice code={newCode} onDone={() => window.location.reload()} />;
  }
  if (info && info.role !== 'backup') {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">{t('promote.title')}</h1>
        <p className="rounded-md bg-info-soft p-3">{t('promote.notBackup')}</p>
        <Link to="/" className="inline-flex min-h-touch items-center underline">
          {t('accessDenied.back')}
        </Link>
      </section>
    );
  }

  const copy = info?.backupCopy;
  const mainReachable = info?.connection === 'online';
  // Planned switch (main computer reachable, copy complete): it hands over everything first.
  // Never a complete copy (main computer stopped during the first copy): always confirm.
  const neverComplete = !!copy && !copy.everComplete;
  const needTick = mustTick || neverComplete || !mainReachable || !copy?.complete;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await desktopBridge()!.promote({
      email,
      ...(useCode ? { recoveryCode: code, newPassword } : { password }),
      understood: needTick && understood,
    });
    setBusy(false);
    if (r.ok) {
      if (r.data.recoveryCode) setNewCode(r.data.recoveryCode);
      else window.location.reload();
      return;
    }
    const m = r.error.msg;
    if (isMsg(m) && m.key === 'promote.mustConfirm') setMustTick(true);
    setError(m ?? r.error.message);
  };

  return (
    <section aria-labelledby="promote-title" className="max-w-2xl space-y-5">
      <h1 id="promote-title" className="text-2xl font-bold sm:text-3xl">
        {t('promote.title')}
      </h1>

      <div className="space-y-2 rounded-lg border-2 border-warn bg-warn-soft p-4" role="note">
        <p className="font-bold">{t('promote.when')}</p>
        <p className="font-semibold">{t('promote.whatHappens')}</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>{t('promote.effectStations')}</li>
          <li>{t('promote.effectOldMain')}</li>
          <li>{t('promote.effectNewBackup')}</li>
        </ul>
      </div>

      <p
        className={`rounded-md p-3 font-semibold ${!neverComplete && mainReachable && copy?.complete ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
        data-testid="promote-copy-state"
      >
        {neverComplete
          ? t('promote.neverComplete')
          : mainReachable && copy?.complete
            ? t('promote.planned')
            : t('promote.unplanned', {
                time: copy?.lastCopiedAt ? dateTime(copy.lastCopiedAt) : t('promote.never'),
              })}
      </p>

      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        className="space-y-4 rounded-lg border border-line bg-surface p-5"
      >
        <TextField
          label={t('login.email')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        {useCode ? (
          <>
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
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={busy}
            />
          </>
        ) : (
          <TextField
            label={t('promote.adminPassword')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        )}
        <button
          type="button"
          className="min-h-touch text-left underline"
          onClick={() => setUseCode((v) => !v)}
          disabled={busy}
        >
          {useCode ? t('promote.usePassword') : t('promote.useCode')}
        </button>
        {needTick && (
          <label className="flex min-h-touch items-start gap-3 font-semibold">
            <input
              type="checkbox"
              className="mt-1 size-5"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              disabled={busy}
              data-testid="promote-understood"
            />
            {t('promote.understood')}
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
            {text(error)}
          </p>
        )}
        <Button
          type="submit"
          variant="danger"
          disabled={busy || (needTick && !understood)}
          className="min-h-14 w-full text-lg"
          data-testid="promote-button"
        >
          {busy ? t('promote.working') : t('promote.button')}
        </Button>
      </form>
      <Link to="/station" className="inline-flex min-h-touch items-center underline">
        {t('promote.cancel')}
      </Link>
    </section>
  );
}
