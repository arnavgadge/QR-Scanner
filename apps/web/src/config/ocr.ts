/**
 * OCR tuning. Everything here is meant to be adjusted against REAL factory photos.
 * Confidence values are the OCR engine's own percentages (0-100); this app never invents one.
 */

/** A reading at or above `high` follows the normal flow; below `medium` is treated as low. */
export const OCR_CONFIDENCE = { high: 85, medium: 65 } as const;

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

/** 'unknown' when the engine reported no confidence (never a fabricated number). */
export function confidenceLevel(confidence: number | undefined): ConfidenceLevel {
  if (confidence === undefined || Number.isNaN(confidence)) return 'unknown';
  if (confidence >= OCR_CONFIDENCE.high) return 'high';
  if (confidence >= OCR_CONFIDENCE.medium) return 'medium';
  return 'low';
}

/** Characters the engine may output; engraved serials are upper-case letters, digits and "-". */
export const OCR_CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

/** Photos are downscaled so the longest side is at most this many pixels before recognition. */
export const OCR_MAX_IMAGE_SIDE = 2000;

export const OCR_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Candidates shorter than this are ignored as noise. */
export const OCR_MIN_SERIAL_LENGTH = 4;

/** Candidates longer than this are merged lines of text, not a serial. */
export const OCR_MAX_SERIAL_LENGTH = 40;

/** Where the self-hosted engine files live (see scripts/copy-ocr-assets.mjs). */
export const OCR_ASSET_BASE = `${import.meta.env.BASE_URL}tesseract`;

/** Dev-only mock provider switch (ignored in production builds). */
export const USE_MOCK_OCR: boolean =
  import.meta.env.DEV && import.meta.env.VITE_OCR_PROVIDER === 'mock';
