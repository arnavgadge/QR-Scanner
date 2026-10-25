import { useState } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { ExportHistoryList, ImportHistoryList, ScanHistoryPanel } from '../../features/admin';
import { useImportHistory } from '../../hooks/useImportHistory';
import type { MessageKey } from '../../i18n';

type Tab = 'scans' | 'imports' | 'exports';
const TABS: { id: Tab; label: MessageKey }[] = [
  { id: 'scans', label: 'history.tabScans' },
  { id: 'imports', label: 'history.tabImports' },
  { id: 'exports', label: 'history.tabExports' },
];

export default function AdminHistoryPage() {
  const [tab, setTab] = useState<Tab>('scans');
  const { t } = useI18n();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-4 text-2xl font-bold sm:text-3xl">
        {t('history.title')}
      </h1>
      <div role="tablist" aria-label={t('history.typeAria')} className="mb-4 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            data-testid={`tab-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`min-h-touch rounded-md px-4 font-semibold ${
              tab === item.id
                ? 'bg-action text-on-accent'
                : 'border border-line bg-surface hover:bg-action-soft'
            }`}
          >
            {t(item.label)}
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
