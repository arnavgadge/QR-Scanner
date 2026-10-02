import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { getActiveCompanies } from '../../services/companies/companyService';
import { toAppError } from '../../services/errors';
import {
  CompaniesContext,
  type CompaniesContextValue,
  type CompaniesState,
} from './CompaniesContext';

/**
 * Route shell (mounted only for signed-in users) that loads active companies ONCE and shares
 * them, plus the selected company, with every page below it. One read, not one per component.
 */
export function CompaniesShell() {
  const [state, setState] = useState<CompaniesState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState('');

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getActiveCompanies()
      .then((companies) => {
        if (cancelled) return;
        setState({ status: 'ready', companies });
        // Keep the current selection if it still exists; otherwise fall back to the first company.
        setSelectedId((prev) =>
          companies.some((c) => c.id === prev) ? prev : (companies[0]?.id ?? ''),
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: toAppError(e, 'Unable to load company configuration.').message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo<CompaniesContextValue>(
    () => ({
      ...state,
      selectedId,
      selected:
        state.status === 'ready' ? state.companies.find((c) => c.id === selectedId) : undefined,
      select: setSelectedId,
      reload,
    }),
    [state, selectedId, reload],
  );

  return (
    <CompaniesContext value={value}>
      <Outlet />
    </CompaniesContext>
  );
}
