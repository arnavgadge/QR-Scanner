import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { dataService } from '../../data';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../hooks/useI18n';
import { msg, type Text } from '../../i18n';
import { AppError, errorText, toAppError } from '../../services/errors';
import {
  generateLabelCode,
  PrintError,
  printLabel,
  type GeneratedCode,
  type LabelData,
} from '../../services/printing';
import { logError } from '../../utils/log';
import { PrintableLabel } from '../printing/PrintableLabel';
import { reprintLabelData } from './reprintLabelData';

interface Props {
  companyId: string;
  serial: string;
  /** Larger button (duplicate screen). */
  large?: boolean;
}

type Phase =
  | { step: 'idle' }
  /** An administrator has to sign in first (the station itself may never reprint). */
  | { step: 'sign-in'; error?: Text }
  | { step: 'working' }
  | { step: 'sent'; count: number }
  | { step: 'error'; message: Text };

const needsAdmin = (e: unknown) =>
  e instanceof AppError && (e.code === 'session-expired' || e.code === 'permission-denied');

/**
 * "Print label" for a serial that is ALREADY registered (admin search, red duplicate screen).
 * Administrators only: the server refuses the reprint without an administrator's sign-in, so a
 * station cannot print a second label for a serial that is already on a product. Every reprint is
 * logged (serial, station, administrator, time) in Scan History before anything is printed, and
 * prints on THIS station's printer. If nobody is signed in, an administrator signs in here; that
 * sign-in ends again after the print.
 */
export function ReprintLabel({ companyId, serial, large = false }: Props) {
  const { t, text } = useI18n();
  const auth = useAuth();
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const [job, setJob] = useState<{ label: LabelData; code: GeneratedCode; id: number } | null>(
    null,
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const count = useRef(0);
  const busy = useRef(false);
  /** The administrator signed in only for this reprint: signed out again afterwards. */
  const signedInHere = useRef(false);
  const signOut = auth.signOut;

  const endTemporarySignIn = () => {
    if (!signedInHere.current) return;
    signedInHere.current = false;
    void signOut().catch((e) => logError('Sign-out after reprint failed', e));
  };

  const reprint = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ step: 'working' });
    try {
      // Logged by the server first; refused unless an administrator is signed in.
      const found = await dataService.reprintLabel(companyId, serial);
      const label = reprintLabelData(found);
      if (!label) {
        setPhase({ step: 'error', message: msg('codeType.notConfiguredLong') });
        endTemporarySignIn();
        busy.current = false;
        return;
      }
      setJob({ label, code: generateLabelCode(label), id: Date.now() });
      // The print itself runs once the print copy is rendered (effect below).
    } catch (e) {
      busy.current = false;
      if (needsAdmin(e)) {
        signedInHere.current = false;
        setPhase({ step: 'sign-in', error: errorText(e as AppError) });
        return;
      }
      logError('Reprint failed', e);
      setPhase({ step: 'error', message: errorText(toAppError(e)) });
      endTemporarySignIn();
    }
  };

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    void printLabel(job.label)
      .then(() => {
        count.current += 1;
        if (!cancelled) setPhase({ step: 'sent', count: count.current });
      })
      .catch((e) => {
        logError('Reprint printing failed', e);
        const noPrinter = e instanceof PrintError && e.code === 'no-printer';
        if (!cancelled) {
          setPhase({
            step: 'error',
            message: msg(noPrinter ? 'print.noPrinter' : 'print.failed'),
          });
        }
      })
      .finally(() => {
        busy.current = false;
        if (!cancelled) setJob(null);
        endTemporarySignIn();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one print per job
  }, [job]);

  const isAdmin = auth.status === 'ready' && auth.user.role === 'admin';
  const start = () => {
    if (isAdmin) void reprint();
    else setPhase({ step: 'sign-in' });
  };

  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setPhase({ step: 'sign-in', error: msg('login.passwordRequired') });
      return;
    }
    setPhase({ step: 'working' });
    try {
      await auth.signIn(email.trim(), password);
      signedInHere.current = true;
      setPassword('');
    } catch (err) {
      setPhase({ step: 'sign-in', error: errorText(toAppError(err, msg('auth.signInFailed'))) });
      return;
    }
    await reprint();
  };

  const working = phase.step === 'working';
  return (
    <div className="space-y-2" data-testid="reprint" data-reprint-step={phase.step}>
      {phase.step !== 'sign-in' && (
        <Button
          variant="secondary"
          onClick={start}
          disabled={working}
          aria-busy={working}
          data-testid="reprint-button"
          className={large ? 'min-h-14 w-full text-lg' : ''}
        >
          {working ? t('reprint.printing') : t('reprint.button')}
        </Button>
      )}
      {phase.step === 'sign-in' && (
        <form
          onSubmit={(e) => void submitSignIn(e)}
          className="space-y-3 rounded-md border border-line bg-surface p-3"
          aria-label={t('reprint.signInTitle')}
          data-testid="reprint-sign-in"
        >
          <p className="font-semibold">{t('reprint.signInTitle')}</p>
          <p className="text-sm text-ink-muted">{t('reprint.signInHelp')}</p>
          <TextField
            label={t('login.email')}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <TextField
            label={t('login.password')}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {phase.error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {text(phase.error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{t('reprint.signInAndPrint')}</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPassword('');
                setPhase({ step: 'idle' });
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      <div aria-live="polite">
        {phase.step === 'sent' && (
          <p className="text-sm text-ink-muted" data-testid="reprint-status">
            {t('reprint.sent', { count: phase.count })}
          </p>
        )}
        {phase.step === 'error' && (
          <p role="alert" className="text-sm font-semibold text-danger" data-testid="reprint-error">
            {text(phase.message)}
          </p>
        )}
      </div>
      {job && <PrintableLabel key={job.id} label={job.label} code={job.code} />}
    </div>
  );
}
