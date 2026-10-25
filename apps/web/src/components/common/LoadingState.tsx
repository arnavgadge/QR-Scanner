import { useI18n } from '../../hooks/useI18n';

export function LoadingState({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" className="flex items-center gap-3 p-4 text-ink-muted">
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-line border-t-action"
      />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}
