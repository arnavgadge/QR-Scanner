import { LABEL_PRINT_DPI, LABEL_SIZE_MM } from '../../config/label';
import { snapBarcodeWidthMm, type LabelData, type QrCode } from '../../services/printing';
import { formatDateTime } from '../../utils/format';
import { CodeSvg } from './CodeSvg';
import { LabelSurface, type LabelMode } from './LabelSurface';

interface Props {
  label: LabelData;
  code: QrCode;
  mode?: LabelMode;
}

/**
 * QR label: the actual QR code on the left; company, part number and the serial as real text on
 * the right. It never contains a barcode. Sizes are in cqw (see LabelSurface).
 */
export function QRCodeLabel({ label, code, mode = 'preview' }: Props) {
  // In print the QR is a whole number of printer dots per module (never stretched; always square).
  const snapped =
    mode === 'print'
      ? snapBarcodeWidthMm({
          totalModules: code.size,
          availableMm: LABEL_SIZE_MM.width * 0.4,
          dpi: LABEL_PRINT_DPI,
        })
      : null;
  const side = snapped ? `${snapped.widthMm}mm` : '40cqw';
  return (
    <LabelSurface codeType="qr" mode={mode}>
      <div className="flex h-full items-center" style={{ padding: '3cqw 4cqw', gap: '4cqw' }}>
        <CodeSvg
          code={code}
          label={`QR code encoding ${code.value}`}
          className="block shrink-0"
          style={{ width: side, height: side }}
        />
        <div className="min-w-0 flex-1" style={{ lineHeight: 1.15 }}>
          <p
            data-testid="label-company"
            className="truncate font-bold"
            style={{ fontSize: '5cqw' }}
          >
            {label.companyName}
          </p>
          <p data-testid="label-part" style={{ fontSize: '4cqw' }}>
            Part No: {label.partNo || '—'}
          </p>
          <p
            data-testid="label-serial"
            className="font-mono font-bold break-all"
            style={{ fontSize: '5.6cqw', marginTop: '2cqw' }}
          >
            {label.serial}
          </p>
          {label.timestamp && (
            <p data-testid="label-time" style={{ fontSize: '3cqw', marginTop: '1.5cqw' }}>
              {formatDateTime(label.timestamp)}
            </p>
          )}
        </div>
      </div>
    </LabelSurface>
  );
}
