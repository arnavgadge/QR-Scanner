/** Phase 0 token check: shows the semantic colour language (blue/green/red/gray). */
export function StatusSwatches() {
  const base = 'flex min-h-touch items-center justify-center rounded-md px-4 text-center font-semibold';
  return (
    <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Design tokens">
      <li className={`${base} bg-action text-white`}>Action</li>
      <li className={`${base} bg-success text-white`}>Success / Print</li>
      <li className={`${base} bg-danger text-white`}>Duplicate / Stop</li>
      <li className={`${base} bg-info-soft text-info`}>Information</li>
    </ul>
  );
}
