import { ExportPanel } from '../../features/admin';

export default function AdminExportPage() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        Export Serial Data
      </h1>
      <p className="mt-2 mb-6 max-w-xl text-ink-muted">
        Download the current registered serial data from Firestore as an Excel workbook: one sheet
        with every serial (including its source: excel, manual or scan) and a summary sheet. The
        export reads every serial once, so it can take a moment on a large dataset.
      </p>
      <ExportPanel />
    </section>
  );
}
