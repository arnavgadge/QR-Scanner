import { RouterProvider } from 'react-router-dom';
import { isFirebaseConfigured } from '../config/firebase';
import { ConfigMissingScreen } from './ConfigMissingScreen';
import { AppProviders } from './providers';
import { router } from './router';

export default function App() {
  if (!isFirebaseConfigured) return <ConfigMissingScreen />;
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
