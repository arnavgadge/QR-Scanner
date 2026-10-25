import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../hooks/useI18n';

/**
 * Signed-in user + Log out. 'inline' (default) for the operator header row; 'stacked' for the
 * narrow admin sidebar: name on its own line, full-width Log out button below, so nothing overflows.
 */
export function UserMenu({ layout = 'inline' }: { layout?: 'inline' | 'stacked' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  if (auth.status !== 'ready') return null;

  const logout = async () => {
    await auth.signOut().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  return (
    <div className={layout === 'stacked' ? 'flex flex-col gap-3' : 'flex items-center gap-3'}>
      <span className={`text-sm ${layout === 'stacked' ? 'break-words' : 'whitespace-nowrap'}`}>
        <span className="font-semibold">{auth.user.name}</span>
        <span className="ml-1 text-ink-muted">
          ({t(auth.user.role === 'admin' ? 'role.admin' : 'role.operator')})
        </span>
      </span>
      <Button
        variant="secondary"
        onClick={() => void logout()}
        className={`whitespace-nowrap ${layout === 'stacked' ? 'w-full' : ''}`}
      >
        {t('common.logOut')}
      </Button>
    </div>
  );
}
