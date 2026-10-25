import { RecentScans, ScanWorkflow } from '../../features/operator';
import { useI18n } from '../../hooks/useI18n';
import { useRecentScans } from '../../hooks/useRecentScans';

export default function ScanPage() {
  const { t } = useI18n();
  const recent = useRecentScans(20);
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-4 text-2xl font-bold sm:text-3xl">
        {t('scan.title')}
      </h1>
      <ScanWorkflow onVerified={recent.refresh} />
      <RecentScans recent={recent} />
    </section>
  );
}
