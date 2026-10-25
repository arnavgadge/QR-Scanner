import type { Text } from '../../i18n/core';
import { createContext } from 'react';
import type { Company } from '../../types';

export type CompaniesState =
  | { status: 'loading' }
  | { status: 'error'; message: Text }
  | { status: 'ready'; companies: Company[] };

export type CompaniesContextValue = CompaniesState & {
  selectedId: string;
  selected: Company | undefined;
  select: (companyId: string) => void;
  reload: () => void;
};

export const CompaniesContext = createContext<CompaniesContextValue | null>(null);
