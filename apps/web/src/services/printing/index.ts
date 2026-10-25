/**
 * Label boundary.
 *   Phase 7: label data + real barcode/QR generation + on-screen preview.
 *   Phase 8: browser printing (printService: the only caller of window.print).
 * Registration (Phase 3, Firestore), code generation, label rendering and printing are separate
 * steps; nothing here touches Firestore.
 */
export { buildLabelData, CODE_TYPE_NOT_CONFIGURED_MESSAGE, labelSizeOf } from './labelData';
export type { LabelData, LabelDataResult } from './labelData';
export {
  CODE_GENERATION_FAILED_MESSAGE,
  CodeGenerationError,
  codeToSvg,
  generateCode,
  generateLabelCode,
} from './codeGenerator';
export type { BarcodeCode, GeneratedCode, QrCode } from './codeGenerator';
export { buildBarcodeValue, buildQrPayload } from './labelPayload';
export { pageCss, snapBarcodeWidthMm } from './printLayout';
export {
  endLabelPrint,
  PRINT_BODY_CLASS,
  PRINT_FAILED_MESSAGE,
  PRINT_ROOT_CLASS,
  PrintError,
  printLabel,
} from './printService';
export type { PrintEnv, PrintErrorCode } from './printService';
