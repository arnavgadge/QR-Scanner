import { OCR_MAX_IMAGE_SIDE } from '../../config/ocr';
import { OcrError } from './types';

/**
 * Lightweight, non-destructive preprocessing for engraved text (browser only):
 *  - honour the photo's EXIF orientation
 *  - downscale very large phone photos (speed) - never upscale
 *  - grayscale
 *  - linear contrast stretch between the 1st and 99th brightness percentiles
 * No thresholding/binarization and no blur/sharpen: those can erase thin engraved strokes.
 * The decoded image exists only in memory and is discarded after recognition.
 */
export async function preprocessImage(image: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  } catch (e) {
    throw new OcrError('unreadable-image', 'This file could not be read as an image.', {
      cause: e,
    });
  }
  try {
    const scale = Math.min(1, OCR_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new OcrError('failed', 'Image processing is not available in this browser.');
    ctx.drawImage(bitmap, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
      d[i] = d[i + 1] = d[i + 2] = g;
      hist[g] = (hist[g] ?? 0) + 1;
    }
    const total = w * h;
    let lo = 0;
    let hi = 255;
    for (let acc = 0; lo < 255; lo++) {
      acc += hist[lo] ?? 0;
      if (acc >= total * 0.01) break;
    }
    for (let acc = 0; hi > 0; hi--) {
      acc += hist[hi] ?? 0;
      if (acc >= total * 0.01) break;
    }
    if (hi - lo >= 16) {
      const k = 255 / (hi - lo);
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.max(0, Math.min(255, Math.round((d[i]! - lo) * k)));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  } finally {
    bitmap.close();
  }
}
