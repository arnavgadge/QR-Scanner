import { describe, expect, it } from 'vitest';
import { generateCode, pageCss, snapBarcodeWidthMm } from '../src/services/printing';
import { LABEL_CONTENT_WIDTH_FRACTION, LABEL_PRINT_DPI, LABEL_SIZE_MM } from '../src/config/label';

describe('snapBarcodeWidthMm (whole printer dots per module; never stretched)', () => {
  it('returns the widest whole-dot width that fits', () => {
    const r = snapBarcodeWidthMm({ totalModules: 200, availableMm: 64.4, dpi: 203 })!;
    expect(r.dotsPerModule).toBe(2);
    expect(r.widthMm).toBeCloseTo((400 / 203) * 25.4, 6);
    expect(r.widthMm).toBeLessThanOrEqual(64.4);
    // exactly an integer number of dots at the printer resolution
    expect((r.widthMm / 25.4) * 203).toBeCloseTo(400, 6);
  });

  it('never exceeds the available width, for many sizes and both common printer resolutions', () => {
    for (const dpi of [203, 300, 600]) {
      for (let modules = 60; modules <= 400; modules += 7) {
        const r = snapBarcodeWidthMm({ totalModules: modules, availableMm: 64.4, dpi });
        if (!r) continue;
        expect(r.widthMm).toBeLessThanOrEqual(64.4 + 1e-9);
        expect(Number.isInteger(r.dotsPerModule)).toBe(true);
        expect(((r.widthMm / 25.4) * dpi) / modules).toBeCloseTo(r.dotsPerModule, 6);
      }
    }
  });

  it('returns null when not even one dot per module fits (and for nonsense input)', () => {
    expect(snapBarcodeWidthMm({ totalModules: 2000, availableMm: 64.4, dpi: 203 })).toBeNull();
    expect(snapBarcodeWidthMm({ totalModules: 0, availableMm: 64, dpi: 203 })).toBeNull();
    expect(snapBarcodeWidthMm({ totalModules: 100, availableMm: 0, dpi: 203 })).toBeNull();
    expect(snapBarcodeWidthMm({ totalModules: 100, availableMm: 64, dpi: 0 })).toBeNull();
  });

  it('a typical serial barcode fits the configured label at the configured printer resolution', () => {
    const code = generateCode({ codeType: 'barcode', value: '13WAA000000401' });
    if (code.kind !== 'barcode') throw new Error('barcode expected');
    const r = snapBarcodeWidthMm({
      totalModules: code.totalModules,
      availableMm: LABEL_SIZE_MM.width * LABEL_CONTENT_WIDTH_FRACTION,
      dpi: LABEL_PRINT_DPI,
    });
    expect(r).not.toBeNull();
    expect(r!.dotsPerModule).toBeGreaterThanOrEqual(2); // thermal-printer-friendly module width
  });

  it('a typical QR fits in its 40%-of-width box at whole dots per module', () => {
    const code = generateCode({ codeType: 'qr', value: '27BXX0000001' });
    if (code.kind !== 'qr') throw new Error('qr expected');
    const r = snapBarcodeWidthMm({
      totalModules: code.size,
      availableMm: LABEL_SIZE_MM.width * 0.4,
      dpi: LABEL_PRINT_DPI,
    });
    expect(r).not.toBeNull();
    expect(r!.dotsPerModule).toBeGreaterThanOrEqual(4);
  });
});

describe('pageCss', () => {
  it('sets the page to the label size with no margins (one label per page)', () => {
    expect(pageCss({ width: 70, height: 35 })).toBe('@page { size: 70mm 35mm; margin: 0; }');
    expect(pageCss({ width: 100, height: 50 })).toBe('@page { size: 100mm 50mm; margin: 0; }');
  });
});
