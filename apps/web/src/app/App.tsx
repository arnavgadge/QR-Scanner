import { lazy, Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { dataService } from '../data';
import { PreferencesProvider } from '../features/preferences';
import { ConfigMissingScreen } from './ConfigMissingScreen';
import { AppProviders } from './providers';
import { router } from './router';

// Desktop only: first-run setup (server or station) before the app itself.
const DesktopGate =
  import.meta.env.MODE === 'desktop' ? lazy(() => import('../desktop/DesktopGate')) : null;

export default function App() {
  return (
    // Outermost: language and theme apply to every screen, including the configuration error.
    <PreferencesProvider>
      {dataService.configuration.ready ? (
        <AppProviders>
          {DesktopGate ? (
            <Suspense fallback={null}>
              <DesktopGate>
                <RouterProvider router={router} />
              </DesktopGate>
            </Suspense>
          ) : (
            <RouterProvider router={router} />
          )}
        </AppProviders>
      ) : (
        <ConfigMissingScreen />
      )}
    </PreferencesProvider>
  );
}
