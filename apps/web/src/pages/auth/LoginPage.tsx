import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { dataService } from '../../data';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../hooks/useI18n';
import type { MessageKey, Text } from '../../i18n';
import { errorText, toAppError } from '../../services/errors';

import { msg } from '../../i18n/core';
export default function LoginPage() {
  const auth = useAuth();
  const { t, text } = useI18n();
  // Desktop: only administrators sign in (for admin pages); scanning needs no sign-in.
  const adminOnly = dataService.capabilities.stationScanning;
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: MessageKey; password?: MessageKey }>({});
  const [formError, setFormError] = useState<Text | undefined>();
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'ready') {
    return <Navigate to={from ?? (auth.user.role === 'admin' ? '/admin' : '/scan')} replace />;
  }
  if (auth.status === 'loading' && !submitting)
    return <LoadingState label={t('common.checkingSession')} />;
  if (auth.status === 'no-profile' || auth.status === 'inactive' || auth.status === 'error') {
    // Let the route guard on "/" render the account-status screen (with logout).
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: { email?: MessageKey; password?: MessageKey } = {};
    if (!email.trim()) errors.email = 'login.emailRequired';
    else if (!email.includes('@')) errors.email = 'login.emailInvalid';
    if (!password) errors.password = 'login.passwordRequired';
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      await auth.signIn(email, password);
      // On success the auth listener updates state and this page redirects by role.
    } catch (err) {
      setFormError(errorText(toAppError(err, msg('auth.signInFailed'))));
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="login-title">
      <h1 id="login-title" className="text-2xl font-bold">
        {adminOnly ? t('login.adminTitle') : t('login.title')}
      </h1>
      {adminOnly && <p className="mt-2 text-ink-muted">{t('login.adminHelp')}</p>}
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-4 space-y-4">
        <TextField
          label={t('login.email')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email && t(fieldErrors.email)}
          disabled={submitting}
        />
        <TextField
          label={t('login.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password && t(fieldErrors.password)}
          disabled={submitting}
        />
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
            {text(formError)}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="min-h-14 w-full text-lg">
          {submitting ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>
      {import.meta.env.MODE === 'desktop' && (
        <Link
          to="/recover"
          className="mt-4 mr-6 inline-flex min-h-touch items-center underline"
          data-testid="forgot-password"
        >
          {t('recovery.forgot')}
        </Link>
      )}
      {adminOnly && (
        <Link to="/" className="mt-4 inline-flex min-h-touch items-center underline">
          {t('accessDenied.back')}
        </Link>
      )}
    </section>
  );
}
