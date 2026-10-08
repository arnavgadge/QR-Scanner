import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';

/**
 * Rasterizes the SVG produced by codeToSvg (rects for barcodes, one path for QR) to a grayscale
 * bitmap, then decodes it with ZXing, an independent barcode/QR decoder. A successful decode proves
 * the generated output is a real, machine-readable code carrying the intended value.
 */
export function rasterize(
  svg: string,
  scale = 6,
): { lum: Uint8ClampedArray; w: number; h: number } {
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb) throw new Error('no viewBox');
  const W = Number(vb[1]);
  const H = Number(vb[2]);
  const w = W * scale;
  const h = H * scale;
  const lum = new Uint8ClampedArray(w * h).fill(255);
  const fill = (x: number, y: number, rw: number, rh: number) => {
    for (let yy = Math.round(y * scale); yy < Math.round((y + rh) * scale); yy++)
      for (let xx = Math.round(x * scale); xx < Math.round((x + rw) * scale); xx++)
        lum[yy * w + xx] = 0;
  };
  const dark = svg.includes('<g fill="#000">') ? svg.slice(svg.indexOf('<g fill="#000">')) : svg;
  for (const m of dark.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)) {
    fill(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  }
  const path = /<path fill="#000" d="([^"]*)"/.exec(svg);
  if (path) {
    for (const m of (path[1] as string).matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      fill(Number(m[1]), Number(m[2]), Number(m[3]), 1);
    }
  }
  return { lum, w, h };
}

export function decodeSvg(
  svg: string,
  formats: BarcodeFormat[],
  scale = 6,
): { text: string; format: BarcodeFormat } {
  const { lum, w, h } = rasterize(svg, scale);
  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, formats],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  reader.setHints(hints);
  // decodeWithState keeps the hints (plain decode() resets them to 'all formats').
  const result = reader.decodeWithState(
    new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h))),
  );
  return { text: result.getText(), format: result.getBarcodeFormat() };
}

export { BarcodeFormat };
