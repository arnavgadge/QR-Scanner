import type { Company } from '../../types';

import { CODE_TYPE_LABEL } from './codeTypeLabel';

export function CompanyInfoCard({ company }: { company: Company }) {
  return (
    <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
      <span className="font-semibold">{company.name}</span> — label output:{' '}
      <span className="font-semibold">{CODE_TYPE_LABEL[company.codeType]}</span>
    </p>
  );
}
