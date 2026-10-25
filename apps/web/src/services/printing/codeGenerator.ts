import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { CodeType } from '../../types';
import { LABEL_CODE_LIMITS } from '../../config/label';
import type { LabelData } from './labelData';

/**
 * Real, machine-readable code generation (no DOM, no Firestore): the result is plain vector
 * geometry that a React component renders as SVG, and that Phase 8 can print unchanged.
 *  - barcode: Code 128 (JsBarcode). Chosen because it encodes any printable ASCII serial
 *    (letters, digits, hyphens) compactly with a built-in check digit. The symbology is isolated
 *    here and can be changed if the scanners/printers require another.
 *  - QR: `qrcode`, error correction level M.
 */

export type CodeGenerationErrorReason =
  'invalid-value' | 'unsupported-characters' | 'unsupported-type' | 'library-failure';

export class CodeGenerationError extends Error {
  readonly reason: CodeGenerationErrorReason;
  constructor(reason: CodeGenerationErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CodeGenerationError';
    this.reason = reason;
  }
}

/** The message shown to operators for any generation failure. */
export const CODE_GENERATION_FAILED_MESSAGE = 'Unable to generate label code.';

export interface Bar {
  /** Start, in modules (the narrowest bar width), including the quiet zone. */
  x: number;
  width: number;
}

export interface BarcodeCode {
  kind: 'barcode';
  symbology: 'CODE128';
  /** The encoded value. */
  value: string;
  /** Modules including both quiet zones. */
  totalModules: number;
  quietZone: number;
  bars: Bar[];
}

export interface QrCode {
  kind: 'qr';
  value: string;
  errorCorrection: 'M';
  /** Modules per side including the quiet zone. */
  size: number;
  quietZone: number;
  /** Dark modules as one SVG path (units = modules, quiet zone included). */
  path: string;
  /** Dark-module matrix without the quiet zone (row-major). */
  matrix: boolean[][];
}

export type GeneratedCode = BarcodeCode | QrCode;

export const BARCODE_QUIET_ZONE = 10; // modules (Code 128 requires >= 10)
export const QR_QUIET_ZONE = 4; // modules (QR spec)
const MAX_BARCODE_LENGTH = LABEL_CODE_LIMITS.barcodeMaxLength;
const MAX_QR_LENGTH = LABEL_CODE_LIMITS.qrMaxLength;

function isPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

function generateBarcode(value: string): BarcodeCode {
  if (!isPrintableAscii(value)) {
    throw new CodeGenerationError(
      'unsupported-characters',
      'Code 128 supports printable ASCII characters only.',
    );
  }
  if (value.length > MAX_BARCODE_LENGTH) {
    throw new CodeGenerationError(
      'invalid-value',
      `Barcode value is longer than ${MAX_BARCODE_LENGTH} characters.`,
    );
  }
  let encodings: { data: string }[];
  try {
    // An object target makes JsBarcode compute the bar pattern without any DOM/canvas.
    const target: { encodings?: { data: string }[] } = {};
    JsBarcode(target, value, { format: 'CODE128', valid: () => undefined });
    encodings = target.encodings ?? [];
  } catch (e) {
    throw new CodeGenerationError('library-failure', 'The barcode library rejected this value.', {
      cause: e,
    });
  }
  const pattern = encodings.map((x) => x.data).join('');
  if (!/^[01]+$/.test(pattern)) {
    throw new CodeGenerationError('library-failure', 'The barcode library produced no bars.');
  }
  const bars: Bar[] = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '1') {
      let j = i;
      while (j < pattern.length && pattern[j] === '1') j++;
      bars.push({ x: BARCODE_QUIET_ZONE + i, width: j - i });
      i = j;
    } else {
      i++;
    }
  }
  return {
    kind: 'barcode',
    symbology: 'CODE128',
    value,
    totalModules: pattern.length + BARCODE_QUIET_ZONE * 2,
    quietZone: BARCODE_QUIET_ZONE,
    bars,
  };
}

function generateQr(value: string): QrCode {
  if (value.length > MAX_QR_LENGTH) {
    throw new CodeGenerationError(
      'invalid-value',
      `QR payload is longer than ${MAX_QR_LENGTH} characters.`,
    );
  }
  let qr: ReturnType<typeof QRCode.create>;
  try {
    qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  } catch (e) {
    throw new CodeGenerationError('library-failure', 'The QR library rejected this payload.', {
      cause: e,
    });
  }
  const n = qr.modules.size;
  const matrix: boolean[][] = [];
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    let c = 0;
    for (let k = 0; k < n; k++) row.push(Boolean(qr.modules.get(r, k)));
    matrix.push(row);
    while (c < n) {
      if (row[c]) {
        let e = c;
        while (e < n && row[e]) e++;
        parts.push(`M${c + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h${e - c}v1h-${e - c}z`);
        c = e;
      } else {
        c++;
      }
    }
  }
  return {
    kind: 'qr',
    value,
    errorCorrection: 'M',
    size: n + QR_QUIET_ZONE * 2,
    quietZone: QR_QUIET_ZONE,
    path: parts.join(''),
    matrix,
  };
}

/** Generates the actual code for `value`. Throws CodeGenerationError on any failure. */
export function generateCode(request: { codeType: CodeType; value: string }): GeneratedCode {
  const { codeType, value } = request;
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    throw new CodeGenerationError(
      'invalid-value',
      'The value to encode is empty or has surrounding whitespace.',
    );
  }
  switch (codeType) {
    case 'barcode':
      return generateBarcode(value);
    case 'qr':
      return generateQr(value);
    default:
      throw new CodeGenerationError('unsupported-type', 'Unsupported code type.');
  }
}

/** Convenience: the code for a label, always of the company-configured type. */
export function generateLabelCode(label: LabelData): GeneratedCode {
  return generateCode({ codeType: label.codeType, value: label.codeValue });
}

/** The code as a standalone SVG document (used by tests and, later, by the print layout). */
export function codeToSvg(code: GeneratedCode, barcodeHeight = 40): string {
  if (code.kind === 'barcode') {
    const rects = code.bars
      .map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="${barcodeHeight}"/>`)
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${code.totalModules} ${barcodeHeight}" shape-rendering="crispEdges"><rect width="${code.totalModules}" height="${barcodeHeight}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${code.size} ${code.size}" shape-rendering="crispEdges"><rect width="${code.size}" height="${code.size}" fill="#fff"/><path fill="#000" d="${code.path}"/></svg>`;
}
