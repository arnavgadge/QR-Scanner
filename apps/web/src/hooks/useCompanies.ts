import { useContext } from 'react';
import {
  CompaniesContext,
  type CompaniesContextValue,
} from '../features/companies/CompaniesContext';

export function useCompanies(): CompaniesContextValue {
  const ctx = useContext(CompaniesContext);
  if (!ctx) throw new Error('useCompanies must be used inside <CompaniesShell>');
  return ctx;
}
