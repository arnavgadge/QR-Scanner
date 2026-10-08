import type { CodeType } from '../../types';
import type { NewSerialResult } from '../serial';
import { buildBarcodeValue, buildQrPayload } from './labelPayload';

/**
 * Everything a label needs, derived from a successful registration. Not stored anywhere:
 * Firestore keeps the business record (SerialRecord); the code and label are rendered from this
 * data on demand.
 */
export interface LabelData {
  serial: string;
  /** '' when no part number is known (never invented). */
  partNo: string;
  companyId: string;
  companyName: string;
  /** Always the COMPANY's configured type; never chosen by the operator or inferred from the serial. */
  codeType: CodeType;
  /** The exact value encoded in the barcode / QR. */
  codeValue: string;
  /** Display name of the operator who registered it. */
  scannedBy: string;
  /** The verified server timestamp (ISO) from the registration; not a new, label-time timestamp. */
  timestamp: string | null;
}

export const CODE_TYPE_NOT_CONFIGURED_MESSAGE = 'Company code type is not configured.';

export type LabelDataResult =
  | { ok: true; label: LabelData }
  | { ok: false; reason: 'code-type-not-configured'; message: string };

/**
 * New-serial result -> label data. The code type is read from the company configuration carried
 * by the verification result. A missing/unsupported type yields an error (no silent default).
 */
export function buildLabelData(result: NewSerialResult): LabelDataResult {
  const codeType = result.company.codeType;
  if (codeType !== 'barcode' && codeType !== 'qr') {
    return {
      ok: false,
      reason: 'code-type-not-configured',
      message: CODE_TYPE_NOT_CONFIGURED_MESSAGE,
    };
  }
  const source = { serial: result.serial, companyId: result.company.id, partNo: result.partNo };
  return {
    ok: true,
    label: {
      serial: result.serial,
      partNo: result.partNo,
      companyId: result.company.id,
      companyName: result.company.name,
      codeType,
      codeValue: codeType === 'barcode' ? buildBarcodeValue(source) : buildQrPayload(source),
      scannedBy: result.scannedByName,
      timestamp: result.scannedAt,
    },
  };
}
