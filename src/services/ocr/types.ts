/**
 * OCR boundary. An OCR provider turns an image into text candidates and nothing more: it knows
 * nothing about companies, Firestore or serial verification. The operator UI depends only on
 * these types, so the provider can be replaced without touching the workflow.
 */

export interface OCRCandidate {
  /** Text fragment as read (word or line, whitespace removed). */
  text: string;
  /** The engine's own confidence, 0-100. Absent when the engine does not report one. */
  confidence?: number;
}

export interface OCRResult {
  /** The provider's best single reading ('' when nothing was read). */
  text: string;
  /** Everything the engine read, untouched. */
  rawText: string;
  /** Overall confidence, 0-100, only if the provider reports it. */
  confidence?: number;
  provider: string;
  /** Word/line fragments, for choosing the most serial-like candidate. */
  candidates: OCRCandidate[];
}

export interface RecognizeOptions {
  signal?: AbortSignal;
}

export interface OCRService {
  readonly provider: string;
  recognize(image: Blob, options?: RecognizeOptions): Promise<OCRResult>;
  /** Optional: start loading the engine early (e.g. when a photo is selected). */
  warmUp?(): Promise<void>;
}

export type OcrErrorCode = 'aborted' | 'unreadable-image' | 'provider-unavailable' | 'failed';

export class OcrError extends Error {
  readonly code: OcrErrorCode;
  constructor(code: OcrErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OcrError';
    this.code = code;
  }
}
