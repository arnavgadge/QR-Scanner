/**
 * Label geometry and print settings. The real printer / label stock is NOT decided yet, so these
 * are development defaults, kept in ONE place and meant to be changed when the hardware is
 * chosen. Label components size everything relative to the label's own width (CSS container
 * units), so the same components render the on-screen preview and the printed label.
 */

/**
 * Reads an optional numeric build-time setting; anything missing, non-numeric or outside the
 * sensible range falls back to the default (a typo can never produce a zero-size label).
 */
function setting(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Physical label size in millimetres. Also becomes the printed page size (@page).
 * Set VITE_LABEL_WIDTH_MM / VITE_LABEL_HEIGHT_MM at build time to match the real label stock
 * (see docs/PRINT_CALIBRATION.md); the defaults are development values.
 */
export const LABEL_SIZE_MM: { readonly width: number; readonly height: number } = {
  width: setting(import.meta.env.VITE_LABEL_WIDTH_MM, 70, 20, 200),
  height: setting(import.meta.env.VITE_LABEL_HEIGHT_MM, 35, 10, 200),
};

/**
 * Printer resolution used to snap barcode bars to whole printer dots (so bars are not printed
 * with uneven widths). 203 dpi is typical for thermal label printers; 300 is the other common
 * value. Set VITE_LABEL_DPI to the real printer's resolution; it only affects barcode width in print.
 */
export const LABEL_PRINT_DPI = setting(import.meta.env.VITE_LABEL_DPI, 203, 72, 1200);

/** Largest on-screen preview width, in CSS pixels. */
export const LABEL_PREVIEW_MAX_WIDTH_PX = 420;

/** Aspect ratio derived from the configured size. */
export const LABEL_ASPECT_RATIO = `${LABEL_SIZE_MM.width} / ${LABEL_SIZE_MM.height}`;

/** Horizontal padding of the label content as a fraction of label width (both sides together). */
export const LABEL_CONTENT_WIDTH_FRACTION = 0.92;

/**
 * Longest value each label code can carry. Shared by code generation AND by serial registration:
 * a serial the label cannot encode must be refused BEFORE it is registered, otherwise it would be
 * consumed with no way to label it.
 */
export const LABEL_CODE_LIMITS = { barcodeMaxLength: 80, qrMaxLength: 300 } as const;
