import type { Company } from '../../types';
import { CODE_TYPE_NOT_CONFIGURED, codeTypeLabel } from './codeTypeLabel';

/**
 * Shows which label this company produces. It is read-only for operators: the code type is
 * company configuration (set by an administrator), never chosen at the scan screen.
 */
export function CompanyInfoCard({ company }: { company: Company }) {
  if (company.codeType === null) {
    return (
      <p
        role="alert"
        className="rounded-md border-2 border-danger bg-danger-soft px-3 py-2 text-sm font-semibold text-danger"
      >
        {company.name} — {CODE_TYPE_NOT_CONFIGURED} Contact an administrator.
      </p>
    );
  }
  return (
    <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
      <span className="font-semibold">{company.name}</span> — label output:{' '}
      <span className="font-semibold">{codeTypeLabel(company.codeType)}</span>
    </p>
  );
}
