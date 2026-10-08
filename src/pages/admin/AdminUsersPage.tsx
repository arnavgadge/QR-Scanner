import { UsersPanel } from '../../features/admin';

export default function AdminUsersPage() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="mb-6 text-2xl font-bold sm:text-3xl">
        Users
      </h1>
      <UsersPanel />
    </section>
  );
}
