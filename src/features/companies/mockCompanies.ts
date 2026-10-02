import type { Company } from '../../types';

/** DEVELOPMENT-ONLY mock data used to verify rendering. Not a database. Remove in Phase 2. */
export const MOCK_COMPANIES: readonly Company[] = [
  { id: 'mock-a', name: 'Company A', codeType: 'barcode', serialFormat: '', active: true },
  { id: 'mock-b', name: 'Company B', codeType: 'qr', serialFormat: '', active: true },
];
