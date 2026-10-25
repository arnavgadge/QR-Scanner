import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `vite build --mode desktop` builds the page for the Electron desktop app: assets load from local
// files (relative base) and the data layer uses the desktop backend instead of Firebase.
/**
 * Desktop only: a strict Content-Security-Policy. The page may load only its own bundled files (no
 * remote scripts, styles, fonts or connections). 'unsafe-inline' styles: label sizes are inline
 * styles; 'wasm-unsafe-eval' + blob workers: the bundled OCR engine (tesseract) runs in WebAssembly.
 */
const DESKTOP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const desktopCsp = (): Plugin => ({
  name: 'desktop-csp',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${DESKTOP_CSP}" />`,
    ),
});

export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    plugins: [react(), tailwindcss(), ...(desktop ? [desktopCsp()] : [])],
    ...(desktop
      ? {
          base: './',
          resolve: {
            alias: [
              {
                find: /^\.\/selectedBackend$/,
                replacement: fileURLToPath(
                  new URL('./src/data/desktop/selectedBackend.ts', import.meta.url),
                ),
              },
            ],
          },
        }
      : {}),
  };
});
