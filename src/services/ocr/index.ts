import { USE_MOCK_OCR } from '../../config/ocr';
import type { OCRService } from './types';

export type { OCRCandidate, OCRResult, OCRService, OcrErrorCode, RecognizeOptions } from './types';
export { OcrError } from './types';
export { pickSerialCandidate, cleanFragment, type PickedCandidate } from './candidate';

/** Name of the active provider, for display (the mock is clearly labelled). */
export const OCR_PROVIDER_LABEL = USE_MOCK_OCR ? 'mock (development only)' : 'tesseract.js';

/**
 * The single place that chooses the OCR provider. Production always gets Tesseract.js; the mock
 * is only reachable in a dev build started with VITE_OCR_PROVIDER=mock. Providers are loaded on
 * demand so the OCR engine is not part of the main bundle.
 */
export async function getOcrService(): Promise<OCRService> {
  // The condition is written inline so production builds can drop the mock entirely.
  if (import.meta.env.DEV && import.meta.env.VITE_OCR_PROVIDER === 'mock') {
    return (await import('./mockOcr')).mockOcrService;
  }
  return (await import('./tesseractOcr')).tesseractOcrService;
}
