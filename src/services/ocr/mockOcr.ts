import { OcrError, type OCRResult, type OCRService, type RecognizeOptions } from './types';

/**
 * DEVELOPMENT / TEST ONLY. Never the production default: it is only selected when the dev server
 * runs with VITE_OCR_PROVIDER=mock (see services/ocr/index.ts), and is removed from production builds.
 *
 * It does not look at the pixels. It reads a scenario from the photo's FILE NAME so every
 * workflow branch can be exercised without real factory photos:
 *
 *   mock-high-<TEXT>.png      -> <TEXT>, confidence 96
 *   mock-medium-<TEXT>.png    -> <TEXT>, confidence 75
 *   mock-low-<TEXT>.png       -> <TEXT>, confidence 40
 *   mock-noconf-<TEXT>.png    -> <TEXT>, no confidence reported
 *   mock-none.png             -> nothing readable (empty result)
 *   mock-noise.png            -> only unusable fragments
 *   mock-error.png            -> provider failure
 *   mock-slow-<TEXT>.png      -> like high, but takes 4 s (to test cancelling)
 */
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new OcrError('aborted', 'OCR was cancelled.'));
    });
  });

const LEVEL: Record<string, number | undefined> = {
  high: 96,
  medium: 75,
  low: 40,
  slow: 96,
  noconf: undefined,
};

export const mockOcrService: OCRService = {
  provider: 'mock (development only)',

  async recognize(image: Blob, options: RecognizeOptions = {}): Promise<OCRResult> {
    const name = (image as File).name ?? '';
    const base = name.replace(/\.[^.]+$/, '');
    await wait(base.startsWith('mock-slow-') ? 4000 : 300, options.signal);

    if (base === 'mock-error') throw new OcrError('failed', 'Mock OCR failure.');
    if (base === 'mock-none')
      return { text: '', rawText: '', provider: this.provider, candidates: [] };
    if (base === 'mock-noise') {
      return {
        text: 'A',
        rawText: '. , A',
        confidence: 12,
        provider: this.provider,
        candidates: [
          { text: 'A', confidence: 12 },
          { text: ',', confidence: 5 },
        ],
      };
    }
    const m = /^mock-(high|medium|low|noconf|slow)-(.+)$/.exec(base);
    if (!m) return { text: '', rawText: '', provider: this.provider, candidates: [] };
    const text = m[2] as string;
    const confidence = LEVEL[m[1] as string];
    return {
      text,
      rawText: text,
      ...(confidence !== undefined ? { confidence } : {}),
      provider: this.provider,
      candidates: [{ text, ...(confidence !== undefined ? { confidence } : {}) }],
    };
  },
};
