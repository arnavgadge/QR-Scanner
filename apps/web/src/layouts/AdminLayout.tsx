import { lazy, Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { UserMenu } from '../features/auth';
import { DisplayControls } from '../features/preferences';
import { useI18n } from '../hooks/useI18n';
import type { MessageKey } from '../i18n';

/** Brand name: a proper name, shown as-is in every language. */
const BRAND = 'VICIMUS';

/** Desktop: backup offline / choose a new backup / registering paused (not in the web build). */
const ClusterBanner =
  import.meta.env.MODE === 'desktop' ? lazy(() => import('../desktop/ClusterBanner')) : null;

const items: { to: string; label: MessageKey; end?: boolean }[] = [
  { to: '/admin', label: 'nav.adminDashboard', end: true },
  { to: '/admin/import', label: 'nav.adminImport' },
  { to: '/admin/export', label: 'nav.adminExport' },
  { to: '/admin/companies', label: 'nav.adminCompanies' },
  { to: '/admin/users', label: 'nav.adminUsers' },
  { to: '/admin/history', label: 'nav.adminHistory' },
  ...(import.meta.env.MODE === 'desktop'
    ? [
        { to: '/admin/find', label: 'nav.findSerial' as MessageKey },
        { to: '/admin/stations', label: 'nav.stations' as MessageKey },
        { to: '/station', label: 'nav.thisComputer' as MessageKey },
      ]
    : []),
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-touch items-center rounded-md px-3 font-semibold ${
    isActive ? 'bg-action text-on-accent' : 'text-ink hover:bg-action-soft'
  }`;

/** Admin shell: sidebar on large screens, a collapsible menu on small ones. */
export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  return (
    <div className="min-h-screen lg:flex">
      {/*
        Sidebar sections share one left edge (px-6 = the menu items' text) and are evenly spaced:
        brand · display controls | navigation | account, with thin dividers between the groups.
      */}
      <aside className="border-b border-line bg-surface lg:min-h-screen lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-2 px-6 pt-5 pb-4">
          <div>
            <p className="text-lg leading-tight font-extrabold tracking-wide">{BRAND}</p>
            <p className="text-sm text-ink-muted">{t('app.adminSubtitle')}</p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-touch items-center rounded-md border border-line px-3 font-semibold lg:hidden"
            aria-expanded={open}
            aria-controls="admin-nav"
            onClick={() => setOpen((o) => !o)}
            data-testid="admin-menu-toggle"
          >
            {open ? t('nav.close') : t('nav.menu')}
          </button>
        </div>
        <div className="px-6 pb-5">
          <DisplayControls />
        </div>
        <nav
          id="admin-nav"
          aria-label={t('nav.admin')}
          className={`${open ? 'flex' : 'hidden'} flex-col border-t border-line lg:flex`}
        >
          <div className="flex flex-col gap-1 px-3 py-4">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.end}
                className={linkClass}
                onClick={() => setOpen(false)}
              >
                {t(i.label)}
              </NavLink>
            ))}
            <NavLink to="/" className="flex min-h-touch items-center px-3 text-ink-muted underline">
              {t('nav.operatorView')}
            </NavLink>
          </div>
          <div className="border-t border-line px-6 py-5">
            <UserMenu layout="stacked" />
          </div>
        </nav>
      </aside>
      <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6">
        <ConnectionBanner />
        {ClusterBanner && (
          <Suspense fallback={null}>
            <ClusterBanner />
          </Suspense>
        )}
        <Outlet />
      </main>
    </div>
  );
}
