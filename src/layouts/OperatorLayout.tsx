import { NavLink, Outlet } from 'react-router-dom';
import { UserMenu } from '../features/auth';
import { useAuth } from '../hooks/useAuth';

const link = ({ isActive }: { isActive: boolean }) =>
  `inline-flex min-h-touch items-center rounded-md px-4 font-semibold ${
    isActive ? 'bg-action text-white' : 'text-ink hover:bg-action-soft'
  }`;

export function OperatorLayout() {
  const auth = useAuth();
  const isAdmin = auth.status === 'ready' && auth.user.role === 'admin';
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <nav
          aria-label="Operator"
          className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2"
        >
          <span className="mr-auto font-bold">Serial Scanning</span>
          <NavLink to="/" end className={link}>
            Scan
          </NavLink>
          <NavLink to="/history" className={link}>
            Recent scans
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={link}>
              Admin
            </NavLink>
          )}
          <UserMenu />
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
