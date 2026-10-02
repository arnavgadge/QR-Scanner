import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { LoadingState } from '../../components/common/LoadingState';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { useAuth } from '../../hooks/useAuth';
import { toAppError } from '../../services/errors';

export default function LoginPage() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  if (auth.status === 'ready') {
    return <Navigate to={auth.user.role === 'admin' ? '/admin' : '/scan'} replace />;
  }
  if (auth.status === 'loading' && !submitting)
    return <LoadingState label="Checking your session…" />;
  if (auth.status === 'no-profile' || auth.status === 'inactive' || auth.status === 'error') {
    // Let the route guard on "/" render the account-status screen (with logout).
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!email.includes('@')) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setFormError(undefined);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      await auth.signIn(email, password);
      // On success the auth listener updates state and this page redirects by role.
    } catch (err) {
      setFormError(toAppError(err, 'Unable to sign in. Please try again.').message);
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="login-title">
      <h1 id="login-title" className="text-2xl font-bold">
        Log in
      </h1>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-4 space-y-4">
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          disabled={submitting}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          disabled={submitting}
        />
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="min-h-14 w-full text-lg">
          {submitting ? 'Signing in…' : 'Log in'}
        </Button>
      </form>
    </section>
  );
}
