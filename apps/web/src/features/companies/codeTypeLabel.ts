import type { MessageKey } from '../../i18n';
import type { CodeType } from '../../types';

const KEYS: Record<CodeType, MessageKey> = { barcode: 'codeType.barcode', qr: 'codeType.qr' };

/** Message key for a code type; "Not configured" when the company has none (never a guess). */
export function codeTypeKey(codeType: CodeType | null): MessageKey {
  return codeType ? KEYS[codeType] : 'codeType.notConfigured';
}
