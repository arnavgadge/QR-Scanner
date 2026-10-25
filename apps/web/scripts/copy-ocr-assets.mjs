// Copies the self-hosted OCR engine files into public/tesseract/ (git-ignored).
// Runs automatically after `npm install` (postinstall). Self-hosting means the OCR engine, its
// WebAssembly core and the English language data are served by this app: no photo and no request
// ever goes to a third-party OCR service, and OCR works on an offline factory network.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const out = 'public/tesseract';
const nm = 'node_modules';
const files = [
  [`${nm}/tesseract.js/dist/worker.min.js`, `${out}/worker.min.js`],
  [
    `${nm}/tesseract.js-core/tesseract-core-lstm.wasm.js`,
    `${out}/core/tesseract-core-lstm.wasm.js`,
  ],
  [
    `${nm}/tesseract.js-core/tesseract-core-simd-lstm.wasm.js`,
    `${out}/core/tesseract-core-simd-lstm.wasm.js`,
  ],
  [
    `${nm}/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js`,
    `${out}/core/tesseract-core-relaxedsimd-lstm.wasm.js`,
  ],
  [
    `${nm}/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`,
    `${out}/lang/eng.traineddata.gz`,
  ],
];

if (!files.every(([src]) => existsSync(src))) {
  console.warn('copy-ocr-assets: OCR packages not installed yet; skipping.');
  process.exit(0);
}
rmSync(out, { recursive: true, force: true });
for (const [src, dest] of files) {
  mkdirSync(join(dest, '..'), { recursive: true });
  cpSync(src, dest);
}
console.log(`copy-ocr-assets: copied ${files.length} files to ${out}/`);
