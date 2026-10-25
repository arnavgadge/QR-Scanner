import { useI18n } from '../../hooks/useI18n';
import { logError } from '../../utils/log';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

/** Catches render errors. Never shows stack traces to users; logs to the console only. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('Unhandled UI error', error);
    if (import.meta.env.DEV) logError('Component stack', info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <ErrorScreen />;
  }
}

/** A function component, so the message follows the chosen language. */
function ErrorScreen() {
  const { t } = useI18n();
  return (
    <div role="alert" className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-2xl font-bold text-danger">{t('errorBoundary.title')}</h1>
      <p className="mt-2 text-ink-muted">{t('errorBoundary.body')}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 min-h-touch rounded-md bg-action px-5 font-semibold text-on-accent hover:bg-action-hover"
      >
        {t('common.refresh')}
      </button>
    </div>
  );
}
