import { useI18n } from '../../hooks/useI18n';
import type { Text } from '../../i18n';
import { Button } from '../ui/Button';

interface Props {
  message: Text;
  onRetry?: () => void;
}

export function ErrorNotice({ message, onRetry }: Props) {
  const { t, text } = useI18n();
  return (
    <div role="alert" className="rounded-md border border-danger bg-danger-soft p-4">
      <p className="font-semibold text-danger">{text(message)}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          {t('common.tryAgain')}
        </Button>
      )}
    </div>
  );
}
