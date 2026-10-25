import { lazy, Suspense } from 'react';
import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom';
import { RequireAdmin, RequireStationOrAuth } from '../features/auth';
import { CompaniesShell } from '../features/companies/CompaniesShell';
import { AdminLayout } from '../layouts/AdminLayout';
import { AuthLayout } from '../layouts/AuthLayout';
import { OperatorLayout } from '../layouts/OperatorLayout';
import LoginPage from '../pages/auth/LoginPage';
import HistoryPage from '../pages/operator/HistoryPage';
import ScanPage from '../pages/operator/ScanPage';

// Admin routes are lazy-loaded; operators never download them.
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage'));
const AdminImportPage = lazy(() => import('../pages/admin/AdminImportPage'));
const AdminExportPage = lazy(() => import('../pages/admin/AdminExportPage'));
const AdminCompaniesPage = lazy(() => import('../pages/admin/AdminCompaniesPage'));
const AdminUsersPage = lazy(() => import('../pages/admin/AdminUsersPage'));
const AdminHistoryPage = lazy(() => import('../pages/admin/AdminHistoryPage'));

const lazyEl = (el: React.ReactNode) => <Suspense fallback={<p>…</p>}>{el}</Suspense>;

/** A lazily loaded desktop-only page (the whole branch is dropped from the web build). */
const desktopPage = (load: () => Promise<{ default: React.ComponentType }>) => {
  const Page = lazy(load);
  return lazyEl(<Page />);
};

// The desktop app loads from local files, where only hash URLs work.
const createRouter = import.meta.env.MODE === 'desktop' ? createHashRouter : createBrowserRouter;

export const router = createRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      ...(import.meta.env.MODE === 'desktop'
        ? [{ path: '/recover', element: desktopPage(() => import('../desktop/pages/RecoverPage')) }]
        : []),
    ],
  },
  {
    element: <RequireStationOrAuth />,
    children: [
      {
        // Loads active companies once for everything below (signed-in users only).
        element: <CompaniesShell />,
        children: [
          // Operator routes: any signed-in active user (operators and admins).
          {
            element: <OperatorLayout />,
            children: [
              { path: '/', element: <ScanPage /> },
              { path: '/scan', element: <ScanPage /> },
              { path: '/history', element: <HistoryPage /> },
              ...(import.meta.env.MODE === 'desktop'
                ? [
                    {
                      path: '/station',
                      element: desktopPage(() => import('../desktop/pages/ThisComputerPage')),
                    },
                    {
                      path: '/promote',
                      element: desktopPage(() => import('../desktop/pages/PromotePage')),
                    },
                  ]
                : []),
            ],
          },
          // Admin routes: admins only (UI guard; Firestore rules are the real enforcement).
          {
            element: <RequireAdmin />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { path: '/admin', element: lazyEl(<AdminDashboardPage />) },
                  { path: '/admin/import', element: lazyEl(<AdminImportPage />) },
                  { path: '/admin/export', element: lazyEl(<AdminExportPage />) },
                  { path: '/admin/companies', element: lazyEl(<AdminCompaniesPage />) },
                  { path: '/admin/users', element: lazyEl(<AdminUsersPage />) },
                  { path: '/admin/history', element: lazyEl(<AdminHistoryPage />) },
                  ...(import.meta.env.MODE === 'desktop'
                    ? [
                        {
                          path: '/admin/find',
                          element: desktopPage(() => import('../desktop/pages/FindSerialPage')),
                        },
                        {
                          path: '/admin/stations',
                          element: desktopPage(() => import('../desktop/pages/StationsPage')),
                        },
                      ]
                    : []),
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
