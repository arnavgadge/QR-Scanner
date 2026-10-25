import { DashboardPanel } from '../../features/admin';
import { useI18n } from '../../hooks/useI18n';

export default function AdminDashboardPage() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-6 text-2xl font-bold sm:text-3xl">
        {t('dashboard.title')}
      </h1>
      <DashboardPanel />
    </section>
  );
}
