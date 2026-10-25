import { Link } from 'react-router-dom';
import { useI18n } from '../../hooks/useI18n';

export function AccessDenied() {
  const { t } = useI18n();
  return (
    <section role="alert" className="mx-auto max-w-md py-10 text-center">
      <h1 className="text-3xl font-bold text-danger">{t('accessDenied.title')}</h1>
      <p className="mt-2 text-ink-muted">{t('accessDenied.body')}</p>
      <Link
        to="/"
        className="mt-4 inline-flex min-h-touch items-center rounded-md bg-action px-5 font-semibold text-on-accent hover:bg-action-hover"
      >
        {t('accessDenied.back')}
      </Link>
    </section>
  );
}
