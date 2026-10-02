import { Link } from 'react-router-dom';

export function AccessDenied() {
  return (
    <section role="alert" className="mx-auto max-w-md py-10 text-center">
      <h1 className="text-3xl font-bold text-danger">Access denied</h1>
      <p className="mt-2 text-ink-muted">You do not have permission to access this area.</p>
      <Link
        to="/"
        className="mt-4 inline-flex min-h-touch items-center rounded-md bg-action px-5 font-semibold text-white hover:bg-action-hover"
      >
        Back to scanning
      </Link>
    </section>
  );
}
