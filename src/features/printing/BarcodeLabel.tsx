import type { CSSProperties } from 'react';
import { LABEL_CONTENT_WIDTH_FRACTION, LABEL_PRINT_DPI, LABEL_SIZE_MM } from '../../config/label';
import { snapBarcodeWidthMm, type BarcodeCode, type LabelData } from '../../services/printing';
import { formatDateTime } from '../../utils/format';
import { CodeSvg } from './CodeSvg';
import { LabelSurface, type LabelMode } from './LabelSurface';

interface Props {
  label: LabelData;
  code: BarcodeCode;
  mode?: LabelMode;
}

/**
 * BARCODE label: company, part number, the actual Code 128 barcode, and the serial as real text.
 * It never contains a QR code. Sizes are in cqw (see LabelSurface). The SAME component renders
 * the screen preview and the print copy.
 */
export function BarcodeLabel({ label, code, mode = 'preview' }: Props) {
  // In print, the barcode is NOT stretched to fill the width: it is set to the widest size that
  // is a whole number of printer dots per module (config/label.ts: LABEL_PRINT_DPI).
  const snapped =
    mode === 'print'
      ? snapBarcodeWidthMm({
          totalModules: code.totalModules,
          availableMm: LABEL_SIZE_MM.width * LABEL_CONTENT_WIDTH_FRACTION,
          dpi: LABEL_PRINT_DPI,
        })
      : null;
  const codeStyle: CSSProperties = {
    height: '19cqw',
    ...(snapped ? { width: `${snapped.widthMm}mm`, marginInline: 'auto' } : {}),
  };

  return (
    <LabelSurface codeType="barcode" mode={mode}>
      <div className="flex h-full flex-col justify-between" style={{ padding: '3cqw 4cqw' }}>
        <div
          className="flex items-baseline justify-between gap-[2cqw]"
          style={{ fontSize: '4.6cqw', lineHeight: 1.1 }}
        >
          <span data-testid="label-company" className="truncate font-bold">
            {label.companyName}
          </span>
          <span data-testid="label-part" className="shrink-0">
            Part No: {label.partNo || '—'}
          </span>
        </div>

        <CodeSvg
          code={code}
          label={`Barcode (Code 128) encoding ${code.value}`}
          className={snapped ? 'block' : 'block w-full'}
          style={codeStyle}
        />

        <div className="text-center">
          <p
            data-testid="label-serial"
            className="font-mono font-bold tracking-wider break-all"
            style={{ fontSize: '6.4cqw', lineHeight: 1.1 }}
          >
            {label.serial}
          </p>
          {label.timestamp && (
            <p data-testid="label-time" style={{ fontSize: '3cqw', lineHeight: 1.2 }}>
              {formatDateTime(label.timestamp)}
            </p>
          )}
        </div>
      </div>
    </LabelSurface>
  );
}
