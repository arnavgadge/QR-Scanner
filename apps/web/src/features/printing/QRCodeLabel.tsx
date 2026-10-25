import { LABEL_PRINT_DPI } from '../../config/label';
import {
  labelSizeOf,
  snapBarcodeWidthMm,
  type LabelData,
  type QrCode,
} from '../../services/printing';
import { formatLabelDateTime } from '../../utils/format';
import { CodeSvg } from './CodeSvg';
import { LabelSurface, type LabelMode } from './LabelSurface';
import { LABEL_TEXT } from './labelText';

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
  const size = labelSizeOf(label);
  // In print the QR is a whole number of printer dots per module (never stretched; always square).
  const snapped =
    mode === 'print'
      ? snapBarcodeWidthMm({
          totalModules: code.size,
          availableMm: size.width * 0.4,
          dpi: LABEL_PRINT_DPI,
        })
      : null;
  const side = snapped ? `${snapped.widthMm}mm` : '40cqw';
  return (
    <LabelSurface codeType="qr" mode={mode} sizeMm={size}>
      <div className="flex h-full items-center" style={{ padding: '3cqw 4cqw', gap: '4cqw' }}>
        <CodeSvg
          code={code}
          label={LABEL_TEXT.qrAria(code.value)}
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
            {LABEL_TEXT.partNo} {label.partNo || '—'}
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
              {formatLabelDateTime(label.timestamp)}
            </p>
          )}
        </div>
      </div>
    </LabelSurface>
  );
}
