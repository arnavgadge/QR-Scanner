import { useEffect, useState, type FormEvent } from 'react';
import { RecoveryCodeNotice } from '../RecoveryCodeNotice';
import { serverChoice, serverDisplayName } from './serverChoice';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { DisplayControls } from '../../features/preferences';
import { useI18n } from '../../hooks/useI18n';
import type { Text } from '../../i18n';
import { desktopBridge, type DiscoveredServer } from '../bridge';
import type { WireResult } from '../protocol';

type Step = 'choose' | 'server' | 'node';

/** How long to search before saying the main computer cannot be found (search continues). */
const NOT_FOUND_AFTER_MS = 10_000;

/**
 * First run of the desktop app: is this the main computer (server) or a station? Plain language
 * only; no IP address is ever shown or asked for. Station pairing uses the 6-digit code shown on
 * the main computer.
 */
export function DesktopSetup() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('choose');
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{t('setup.title')}</h1>
        <DisplayControls />
      </div>
      {step === 'choose' && <ChooseMode onChoose={setStep} />}
      {step === 'server' && <ServerSetup onBack={() => setStep('choose')} />}
      {step === 'node' && <StationSetup onBack={() => setStep('choose')} />}
    </main>
  );
}

function ChooseMode({ onChoose }: { onChoose: (s: Step) => void }) {
  const { t } = useI18n();
  const choice = (step: Step, title: string, help: string) => (
    <button
      type="button"
      data-testid={`setup-${step}`}
      onClick={() => onChoose(step)}
      className="w-full rounded-lg border-2 border-line bg-surface p-5 text-left hover:border-action"
    >
      <span className="block text-xl font-bold">{title}</span>
      <span className="mt-1 block text-ink-muted">{help}</span>
    </button>
  );
  return (
    <section className="space-y-4" aria-labelledby="choose-title">
      <p id="choose-title" className="text-lg font-semibold">
        {t('setup.choose')}
      </p>
      {choice('node', t('setup.node'), t('setup.nodeHelp'))}
      {choice('server', t('setup.server'), t('setup.serverHelp'))}
    </section>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Text | null>(null);
  const run = async <T,>(task: () => Promise<WireResult<T>>, onOk?: (data: T) => void) => {
    setBusy(true);
    setError(null);
    const r = await task();
    if (r.ok) {
      if (onOk) return onOk(r.data);
      window.location.reload(); // the main process has switched mode; start the app
      return;
    }
    setError(r.error.msg ?? r.error.message);
    setBusy(false);
  };
  return { busy, error, run };
}

function ServerSetup({ onBack }: { onBack: () => void }) {
  const { t, text } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () => desktopBridge()!.setupServer({ name, email, password }),
      (data) => setRecoveryCode(data.recoveryCode),
    );
  };

  // The main computer is set up: the recovery code is shown once before the app starts.
  if (recoveryCode) {
    return <RecoveryCodeNotice code={recoveryCode} onDone={() => window.location.reload()} />;
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-4 rounded-lg border border-line bg-surface p-5"
    >
      <h2 className="text-xl font-bold">{t('setup.createAdmin')}</h2>
      <p className="text-ink-muted">{t('setup.adminHelp')}</p>
      <TextField
        label={t('setup.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      <TextField
        label={t('login.email')}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
        autoComplete="username"
      />
      <TextField
        label={t('login.password')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
        autoComplete="new-password"
      />
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
          {text(error)}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="submit"
          disabled={busy}
          className="min-h-14 flex-1 text-lg"
          data-testid="setup-finish"
        >
          {busy ? t('setup.starting') : t('setup.finish')}
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={busy} className="min-h-14">
          {t('setup.back')}
        </Button>
      </div>
    </form>
  );
}

function StationSetup({ onBack }: { onBack: () => void }) {
  const { t, text } = useI18n();
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    const bridge = desktopBridge()!;
    const off = bridge.on((e) => {
      if (e.type === 'discovery') setServers(e.servers);
    });
    void bridge.startDiscovery();
    const timer = window.setTimeout(() => setSlow(true), NOT_FOUND_AFTER_MS);
    return () => {
      off();
      window.clearTimeout(timer);
      void bridge.stopDiscovery();
    };
  }, []);

  // More than one main computer: never picked silently (an administrator chooses).
  const { server, mustChoose } = serverChoice(servers, chosen);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!server) return;
    void run(() => desktopBridge()!.pairStation({ server, code }));
  };

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-5" aria-live="polite">
      {servers.length === 0 && (
        <>
          <p className="flex items-center gap-3 text-lg font-semibold">
            <span
              aria-hidden="true"
              className="size-5 animate-spin rounded-full border-2 border-line border-t-action"
            />
            {t('setup.searching')}
          </p>
          {slow && (
            <p
              role="alert"
              className="rounded-md bg-warn-soft p-3 font-semibold text-warn"
              data-testid="setup-not-found"
            >
              {t('setup.notFound')}
            </p>
          )}
        </>
      )}

      {servers.length > 0 && (
        <form onSubmit={submit} noValidate className="space-y-4">
          <p className="font-semibold text-success">✓ {t('setup.found')}</p>
          {mustChoose && (
            <fieldset className="space-y-2" data-testid="setup-choose-server">
              <legend className="rounded-md bg-warn-soft p-3 font-semibold">
                {t('setup.severalFound')}
              </legend>
              {servers.map((s) => (
                <label key={s.serverId} className="flex min-h-touch items-center gap-3">
                  <input
                    type="radio"
                    name="server"
                    checked={server?.serverId === s.serverId}
                    onChange={() => setChosen(s.serverId)}
                    className="size-5"
                  />
                  {serverDisplayName(s)}
                </label>
              ))}
            </fieldset>
          )}
          <TextField
            label={t('setup.code')}
            hint={t('setup.codeHint')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            disabled={busy}
            inputMode="numeric"
            autoComplete="off"
            lang="en"
            variant="code"
            data-testid="setup-code"
          />
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
              {text(error)}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || !server || code.length !== 6}
            className="min-h-14 w-full text-lg"
            data-testid="setup-pair"
          >
            {busy ? t('setup.pairing') : t('setup.pair')}
          </Button>
        </form>
      )}

      <Button variant="secondary" onClick={onBack} disabled={busy}>
        {t('setup.back')}
      </Button>
    </section>
  );
}
