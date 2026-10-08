/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** Dev builds only: use local Auth/Firestore emulators. */
  readonly VITE_USE_FIREBASE_EMULATOR?: string;
  /** Optional label stock / printer settings (see docs/PRINT_CALIBRATION.md). */
  readonly VITE_LABEL_WIDTH_MM?: string;
  readonly VITE_LABEL_HEIGHT_MM?: string;
  readonly VITE_LABEL_DPI?: string;
  /** Dev builds only: 'mock' selects the development-only OCR mock. Default: tesseract.js. */
  readonly VITE_OCR_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
