interface Props {
  title: string;
  route: string;
}

export function PlaceholderPage({ title, route }: Props) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        {title} — Phase 0 Placeholder
      </h1>
      <p className="mt-2 text-ink-muted">
        Route: <code className="rounded bg-info-soft px-1.5 py-0.5 font-mono">{route}</code>
      </p>
    </section>
  );
}
