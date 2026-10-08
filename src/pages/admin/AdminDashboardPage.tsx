import { DashboardPanel } from '../../features/admin';

export default function AdminDashboardPage() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-6 text-2xl font-bold sm:text-3xl">
        Dashboard
      </h1>
      <DashboardPanel />
    </section>
  );
}
