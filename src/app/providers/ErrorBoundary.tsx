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
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-2xl font-bold text-danger">Something went wrong.</h1>
        <p className="mt-2 text-ink-muted">Please refresh or contact an administrator.</p>
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
