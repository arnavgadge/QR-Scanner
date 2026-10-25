/**
 * Text printed ON the label. Deliberately fixed English and NOT in the translation dictionaries:
 * a label must read the same whatever language the operator's screen is in. The barcode/QR
 * contents, serial and part number are data and are never translated either.
 */
export const LABEL_TEXT = {
  partNo: 'Part No:',
  barcodeAria: (value: string) => `Barcode (Code 128) encoding ${value}`,
  qrAria: (value: string) => `QR code encoding ${value}`,
} as const;
