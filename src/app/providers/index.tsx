import type { ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/** Single place to add app-wide providers (auth in Phase 2). Keep global state minimal. */
export function AppProviders({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
