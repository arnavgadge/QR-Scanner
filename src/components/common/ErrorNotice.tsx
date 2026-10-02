import { Button } from '../ui/Button';

interface Props {
  message: string;
  onRetry?: () => void;
}

export function ErrorNotice({ message, onRetry }: Props) {
  return (
    <div role="alert" className="rounded-md border border-danger bg-danger-soft p-4">
      <p className="font-semibold text-danger">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-3">
          Try again
        </Button>
      )}
    </div>
  );
}
