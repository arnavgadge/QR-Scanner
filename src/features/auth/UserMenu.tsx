import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';

export function UserMenu() {
  const auth = useAuth();
  const navigate = useNavigate();
  if (auth.status !== 'ready') return null;

  const logout = async () => {
    await auth.signOut().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">
        <span className="font-semibold">{auth.user.name}</span>
        <span className="ml-1 text-ink-muted">({auth.user.role})</span>
      </span>
      <Button variant="secondary" onClick={() => void logout()}>
        Log out
      </Button>
    </div>
  );
}
