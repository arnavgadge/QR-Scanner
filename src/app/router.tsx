import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAdmin, RequireAuth, RequireOperator } from '../features/auth';
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

const lazyEl = (el: React.ReactNode) => <Suspense fallback={<p>Loading…</p>}>{el}</Suspense>;

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireOperator />,
        children: [
          {
            element: <OperatorLayout />,
            children: [
              { path: '/', element: <ScanPage route="/" /> },
              { path: '/scan', element: <ScanPage route="/scan" /> },
              { path: '/history', element: <HistoryPage /> },
            ],
          },
        ],
      },
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
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
