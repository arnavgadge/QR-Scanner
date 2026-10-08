import { RecentScans } from '../../features/operator';
import { useRecentScans } from '../../hooks/useRecentScans';

export default function HistoryPage() {
  const recent = useRecentScans(50);
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-4 text-2xl font-bold sm:text-3xl">
        Recent scans
      </h1>
      <RecentScans recent={recent} />
    </section>
  );
}
