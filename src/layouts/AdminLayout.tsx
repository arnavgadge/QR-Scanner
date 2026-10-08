import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { UserMenu } from '../features/auth';

const items = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/import', label: 'Import Excel' },
  { to: '/admin/export', label: 'Export Excel' },
  { to: '/admin/companies', label: 'Companies' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/history', label: 'Scan History' },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-touch items-center rounded-md px-3 font-semibold ${
    isActive ? 'bg-action text-white' : 'text-ink hover:bg-action-soft'
  }`;

/** Admin shell: sidebar on large screens, a collapsible menu on small ones. */
export function AdminLayout() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-line bg-surface lg:min-h-screen lg:w-60 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="text-lg leading-tight font-extrabold tracking-wide">VICIMUS</p>
            <p className="text-sm text-ink-muted">Serial Label System</p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-touch items-center rounded-md border border-line px-3 font-semibold lg:hidden"
            aria-expanded={open}
            aria-controls="admin-nav"
            onClick={() => setOpen((o) => !o)}
            data-testid="admin-menu-toggle"
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
        <nav
          id="admin-nav"
          aria-label="Admin"
          className={`${open ? 'flex' : 'hidden'} flex-col gap-1 px-3 pb-3 lg:flex`}
        >
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={linkClass}
              onClick={() => setOpen(false)}
            >
              {i.label}
            </NavLink>
          ))}
          <NavLink to="/" className="flex min-h-touch items-center px-3 text-ink-muted underline">
            Operator view
          </NavLink>
          <div className="px-1 pt-2">
            <UserMenu />
          </div>
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
