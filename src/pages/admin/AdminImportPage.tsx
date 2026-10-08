import { ImportHistoryList, ImportPanel } from '../../features/admin';
import { useImportHistory } from '../../hooks/useImportHistory';

export default function AdminImportPage() {
  const history = useImportHistory(20);
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold sm:text-3xl">
        Import Serial Data
      </h1>
      <p className="mt-2 mb-6 max-w-2xl text-ink-muted">
        Upload an Excel file to add serials to Firestore. The file is checked and previewed first;
        nothing is written until you confirm. Firestore stays the source of truth: existing serials
        are never overwritten.
      </p>
      <ImportPanel onImported={history.refresh} />
      <ImportHistoryList state={history.state} onRetry={history.reload} />
    </section>
  );
}
