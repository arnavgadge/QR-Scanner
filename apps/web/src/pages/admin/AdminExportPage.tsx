import { ExportPanel } from '../../features/admin';
import { useI18n } from '../../hooks/useI18n';

export default function AdminExportPage() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        {t('export.title')}
      </h1>
      <p className="mt-2 mb-6 max-w-xl text-ink-muted">{t('export.intro')}</p>
      <ExportPanel />
    </section>
  );
}
