import type { OCRResult, OCRService } from './index';

/**
 * DEVELOPMENT-ONLY fake OCR. Ignores the image and returns canned text so the review UI can
 * be exercised. Alternates between a known duplicate and a fresh serial. Replaced in Phase 5.
 */
let calls = 0;

export const mockOcrService: OCRService = {
  async extractSerial(): Promise<OCRResult> {
    await new Promise((r) => setTimeout(r, 1200));
    calls += 1;
    const text = calls % 2 === 1 ? 'VC-000001' : `VC-${String(100000 + calls).padStart(6, '0')}`;
    return { text, confidence: 0.9 };
  },
};
