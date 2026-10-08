import type { CodeType } from '../../types';

const LABELS: Record<CodeType, string> = { barcode: 'Barcode', qr: 'QR code' };

export const CODE_TYPE_NOT_CONFIGURED = 'Company code type is not configured.';

/** Human-readable code type; "Not configured" when the company has none (never a guess). */
export function codeTypeLabel(codeType: CodeType | null): string {
  return codeType ? LABELS[codeType] : 'Not configured';
}

/** Kept for existing callers that index by a known code type. */
export const CODE_TYPE_LABEL = LABELS;
