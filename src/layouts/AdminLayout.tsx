import { NavLink, Outlet } from 'react-router-dom';
import { UserMenu } from '../features/auth';

const items = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/import', label: 'Import' },
  { to: '/admin/export', label: 'Export' },
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/history', label: 'History' },
];

export function AdminLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <nav
          aria-label="Admin"
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2"
        >
          <span className="mr-auto font-bold">Admin</span>
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={({ isActive }) =>
                `inline-flex min-h-touch items-center rounded-md px-3 font-semibold ${
                  isActive ? 'bg-action text-white' : 'text-ink hover:bg-action-soft'
                }`
              }
            >
              {i.label}
            </NavLink>
          ))}
          <NavLink
            to="/"
            className="inline-flex min-h-touch items-center px-3 text-ink-muted underline"
          >
            Operator view
          </NavLink>
          <UserMenu />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
