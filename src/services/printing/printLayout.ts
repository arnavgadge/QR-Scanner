/**
 * Print geometry helpers (pure; no DOM). Kept separate from the print service so they can be
 * unit-tested and reused when the real printer is chosen.
 */

/**
 * A Code 128 barcode is made of bars whose widths are whole multiples of one "module". Printed
 * at an arbitrary width, module widths land between printer dots and bars print with uneven
 * widths, which hurts scanning. This returns the widest barcode that fits `availableMm` AND is an
 * exact whole number of printer dots per module (never stretched or compressed to fill the label).
 *
 * Returns null when even 1 dot per module would not fit (the barcode is then printed at the
 * available width and the browser/printer scales it).
 */
export function snapBarcodeWidthMm(input: {
  totalModules: number;
  availableMm: number;
  dpi: number;
}): { widthMm: number; dotsPerModule: number } | null {
  const { totalModules, availableMm, dpi } = input;
  if (totalModules <= 0 || availableMm <= 0 || dpi <= 0) return null;
  const availableDots = (availableMm / 25.4) * dpi;
  const dotsPerModule = Math.floor(availableDots / totalModules);
  if (dotsPerModule < 1) return null;
  return {
    dotsPerModule,
    widthMm: ((dotsPerModule * totalModules) / dpi) * 25.4,
  };
}

/** CSS for the printed page: exactly one label per page, no browser margins. */
export function pageCss(sizeMm: { width: number; height: number }): string {
  return `@page { size: ${sizeMm.width}mm ${sizeMm.height}mm; margin: 0; }`;
}
