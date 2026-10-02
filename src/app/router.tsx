import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RequireAdmin, RequireAuth } from '../features/auth';
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
