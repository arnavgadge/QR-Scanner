/**
 * What gets ENCODED in each code. Isolated here so the payloads can change later without touching
 * the generator or any UI.
 *
 * OPEN BUSINESS QUESTIONS (no requirement exists yet, so the simplest correct choice is used):
 *  - Barcode: the serial number itself (Code 128).
 *  - QR: the serial number itself. If a richer payload (URL, JSON, company + serial, ...) is
 *    required later, change only `buildQrPayload`.
 */
export interface PayloadSource {
  serial: string;
  companyId: string;
  partNo: string;
}

export function buildBarcodeValue(source: PayloadSource): string {
  return source.serial;
}

export function buildQrPayload(source: PayloadSource): string {
  return source.serial;
}
