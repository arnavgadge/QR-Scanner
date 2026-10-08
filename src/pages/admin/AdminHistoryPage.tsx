import { useState } from 'react';
import { ExportHistoryList, ImportHistoryList, ScanHistoryPanel } from '../../features/admin';
import { useImportHistory } from '../../hooks/useImportHistory';

type Tab = 'scans' | 'imports' | 'exports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'scans', label: 'Scan history' },
  { id: 'imports', label: 'Import history' },
  { id: 'exports', label: 'Export history' },
];

export default function AdminHistoryPage() {
  const [tab, setTab] = useState<Tab>('scans');
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-4 text-2xl font-bold sm:text-3xl">
        Scan History
      </h1>
      <div role="tablist" aria-label="History type" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`min-h-touch rounded-md px-4 font-semibold ${
              tab === t.id
                ? 'bg-action text-white'
                : 'border border-line bg-surface hover:bg-action-soft'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'scans' && <ScanHistoryPanel />}
        {tab === 'imports' && <ImportHistory />}
        {tab === 'exports' && <ExportHistoryList />}
      </div>
    </section>
  );
}

function ImportHistory() {
  const history = useImportHistory(50);
  return <ImportHistoryList state={history.state} onRetry={history.reload} />;
}
