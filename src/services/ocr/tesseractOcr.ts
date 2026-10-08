import { OCR_ASSET_BASE, OCR_CHAR_WHITELIST } from '../../config/ocr';
import { preprocessImage } from './imagePreprocess';
import {
  OcrError,
  type OCRCandidate,
  type OCRResult,
  type OCRService,
  type RecognizeOptions,
} from './types';

/**
 * OCR provider: Tesseract.js, running entirely in the browser (WebAssembly in a Web Worker).
 * Photos never leave the device. The worker, engine core and language data are self-hosted
 * (public/tesseract, see scripts/copy-ocr-assets.mjs), so there are no third-party requests.
 *
 * This file is a PROVIDER ADAPTER only: image in, text candidates out. It knows nothing about
 * companies, serial formats or Firestore.
 */

const PROVIDER = 'tesseract.js';

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

let workerPromise: Promise<TesseractWorker> | null = null;

const abs = (path: string) => new URL(path, window.location.origin).href;

async function createEngine(): Promise<TesseractWorker> {
  const mod = await import('tesseract.js');
  const T = (mod as unknown as { default?: TesseractModule }).default ?? mod;
  const worker = await T.createWorker('eng', T.OEM.LSTM_ONLY, {
    workerPath: abs(`${OCR_ASSET_BASE}/worker.min.js`),
    corePath: abs(`${OCR_ASSET_BASE}/core`),
    langPath: abs(`${OCR_ASSET_BASE}/lang`),
    gzip: true,
  });
  await worker.setParameters({
    // Sparse text: finds serial-like text lines scattered in a photo of a part.
    tessedit_pageseg_mode: T.PSM.SPARSE_TEXT,
    ...(OCR_CHAR_WHITELIST ? { tessedit_char_whitelist: OCR_CHAR_WHITELIST } : {}),
    user_defined_dpi: '300',
  });
  return worker;
}

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createEngine().catch((e: unknown) => {
      workerPromise = null; // allow a later retry
      throw new OcrError('provider-unavailable', 'Text recognition could not be started.', {
        cause: e,
      });
    });
  }
  return workerPromise;
}

async function stopWorker(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  try {
    await (await pending)?.terminate();
  } catch {
    // Already gone.
  }
}

function toResult(page: {
  text: string;
  confidence: number;
  blocks?:
    | {
        paragraphs: {
          lines: {
            text: string;
            confidence: number;
            words: { text: string; confidence: number }[];
          }[];
        }[];
      }[]
    | null;
}): OCRResult {
  const candidates: OCRCandidate[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        // Words as read, and the whole line joined (a serial can be split by a gap in the engraving).
        for (const w of line.words) candidates.push({ text: w.text, confidence: w.confidence });
        candidates.push({ text: line.text, confidence: line.confidence });
      }
    }
  }
  const raw = page.text ?? '';
  return {
    text: raw.replace(/\s+/g, ''),
    rawText: raw,
    confidence: Number.isFinite(page.confidence) ? page.confidence : undefined,
    provider: PROVIDER,
    candidates,
  };
}

export const tesseractOcrService: OCRService = {
  provider: PROVIDER,

  async warmUp() {
    try {
      await getWorker();
    } catch {
      // Surfaced when recognize() is actually called.
    }
  },

  async recognize(image: Blob, options: RecognizeOptions = {}): Promise<OCRResult> {
    const { signal } = options;
    const aborted = () => new OcrError('aborted', 'OCR was cancelled.');
    if (signal?.aborted) throw aborted();

    const canvas = await preprocessImage(image);
    if (signal?.aborted) throw aborted();
    const worker = await getWorker();
    if (signal?.aborted) throw aborted();

    // Tesseract cannot cancel a running job, so cancelling stops the worker (a fresh one starts next time).
    const onAbort = () => void stopWorker();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
      if (signal?.aborted) throw aborted();
      return toResult(data as Parameters<typeof toResult>[0]);
    } catch (e) {
      if (signal?.aborted) throw aborted();
      if (e instanceof OcrError) throw e;
      void stopWorker(); // a failed worker may be unusable; start fresh next time
      throw new OcrError('failed', 'Text recognition failed.', { cause: e });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
