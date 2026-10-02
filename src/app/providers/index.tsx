import type { ReactNode } from 'react';
import { AuthProvider } from '../../features/auth';
import { ErrorBoundary } from './ErrorBoundary';

/** Single place for app-wide providers. Keep global state minimal. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>{children}</AuthProvider>
    </ErrorBoundary>
  );
}
