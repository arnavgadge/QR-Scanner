import { UsersPanel } from '../../features/admin';
import { useI18n } from '../../hooks/useI18n';

export default function AdminUsersPage() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-6 text-2xl font-bold sm:text-3xl">
        {t('users.title')}
      </h1>
      <UsersPanel />
    </section>
  );
}
