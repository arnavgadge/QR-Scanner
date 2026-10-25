import { useI18n } from '../../hooks/useI18n';
import type { Company } from '../../types';
import { codeTypeKey } from './codeTypeLabel';

/**
 * Shows which label this company produces. It is read-only for operators: the code type is
 * company configuration (set by an administrator), never chosen at the scan screen.
 */
export function CompanyInfoCard({ company }: { company: Company }) {
  const { t, rich } = useI18n();
  if (company.codeType === null) {
    return (
      <p
        role="alert"
        className="rounded-md border-2 border-danger bg-danger-soft px-3 py-2 text-sm font-semibold text-danger"
      >
        {t('companyCard.notConfigured', { company: company.name })}
      </p>
    );
  }
  return (
    <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info">
      {rich('companyCard.output', {
        company: <span className="font-semibold">{company.name}</span>,
        type: <span className="font-semibold">{t(codeTypeKey(company.codeType))}</span>,
      })}
    </p>
  );
}
