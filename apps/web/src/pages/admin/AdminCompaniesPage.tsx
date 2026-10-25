import { CompaniesPanel } from '../../features/admin';
import { useI18n } from '../../hooks/useI18n';

export default function AdminCompaniesPage() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        {t('companies.pageTitle')}
      </h1>
      <p className="mt-2 mb-6 max-w-2xl text-ink-muted">{t('companies.pageIntro')}</p>
      <CompaniesPanel />
    </section>
  );
}
