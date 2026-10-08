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
    return (
      <div role="alert" className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-2xl font-bold text-danger">This screen could not be displayed.</h1>
        <p className="mt-2 text-ink-muted">
          Nothing was saved or changed by this error. Refresh the page and try again; if it keeps
          happening, tell an administrator what you were doing.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-touch rounded-md bg-action px-5 font-semibold text-white hover:bg-action-hover"
        >
          Refresh
        </button>
      </div>
    );
  }
}
