import { Outlet } from 'react-router-dom';
import { DisplayControls } from '../features/preferences';

export function AuthLayout() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-3 flex justify-end">
        <DisplayControls />
      </div>
      <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
        <Outlet />
      </div>
    </main>
  );
}
