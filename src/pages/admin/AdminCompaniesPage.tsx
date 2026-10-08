import { CompaniesPanel } from '../../features/admin';

export default function AdminCompaniesPage() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        Companies
      </h1>
      <p className="mt-2 mb-6 max-w-2xl text-ink-muted">
        Add and edit companies, choose which label each produces (barcode or QR code), and
        deactivate companies operators should no longer select. A label type change applies to
        serials registered afterwards only; existing serials and history are never altered or
        deleted.
      </p>
      <CompaniesPanel />
    </section>
  );
}
