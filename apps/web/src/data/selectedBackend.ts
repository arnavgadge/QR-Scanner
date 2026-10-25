/**
 * The backend this build uses. Web app: Firebase. The desktop build (vite --mode desktop) replaces
 * this module with ./desktop/selectedBackend.ts (see vite.config.ts), so each bundle contains only
 * its own backend.
 */
export { firebaseDataService as selectedBackend } from './firebase/firebaseDataService';
