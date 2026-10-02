import { PlaceholderPage } from '../../components/common/PlaceholderPage';
import { StatusSwatches } from '../../components/ui/StatusSwatch';
import { MOCK_COMPANIES } from '../../features/companies/mockCompanies';

export default function ScanPage({ route = '/' }: { route?: string }) {
  return (
    <>
      <PlaceholderPage title="Operator Scan" route={route} />
      <StatusSwatches />
      <h2 className="mt-8 text-lg font-bold">Mock companies (development-only)</h2>
      <ul className="mt-2 list-disc pl-5 text-ink-muted">
        {MOCK_COMPANIES.map((c) => (
          <li key={c.id}>
            {c.name} — {c.codeType}
          </li>
        ))}
      </ul>
    </>
  );
}
