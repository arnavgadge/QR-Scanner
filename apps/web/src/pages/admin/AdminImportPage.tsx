import { ImportHistoryList, ImportPanel } from '../../features/admin';
import { useI18n } from '../../hooks/useI18n';
import { useImportHistory } from '../../hooks/useImportHistory';

export default function AdminImportPage() {
  const { t } = useI18n();
  const history = useImportHistory(20);
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        {t('import.title')}
      </h1>
      <p className="mt-2 mb-6 max-w-2xl text-ink-muted">{t('import.intro')}</p>
      <ImportPanel onImported={history.refresh} />
      <ImportHistoryList state={history.state} onRetry={history.reload} />
    </section>
  );
}
