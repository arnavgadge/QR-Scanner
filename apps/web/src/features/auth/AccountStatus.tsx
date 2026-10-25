import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../hooks/useI18n';
import type { Text } from '../../i18n';

/** Shown instead of the app when a signed-in account cannot be used. Always offers logout. */
export function AccountStatus() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t, text } = useI18n();

  let title = t('account.unavailable');
  let message: Text = '';
  if (auth.status === 'no-profile') {
    title = t('account.notConfiguredTitle');
    message = t('account.notConfigured');
  } else if (auth.status === 'inactive') {
    title = t('account.inactiveTitle');
    message = t('account.inactive');
  } else if (auth.status === 'error') {
    message = auth.message;
  }

  const logout = async () => {
    await auth.signOut().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
      <div
        role="alert"
        className="rounded-lg border border-line bg-surface p-6 text-center shadow-sm"
      >
        <h1 className="text-2xl font-bold text-danger">{title}</h1>
        <p className="mt-2 text-ink-muted">{text(message)}</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {auth.status === 'error' && <Button onClick={auth.retry}>{t('common.tryAgain')}</Button>}
          <Button variant="secondary" onClick={() => void logout()}>
            {t('common.logOut')}
          </Button>
        </div>
      </div>
    </main>
  );
}
