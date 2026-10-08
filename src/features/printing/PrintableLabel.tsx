import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  endLabelPrint,
  PRINT_ROOT_CLASS,
  type GeneratedCode,
  type LabelData,
} from '../../services/printing';
import { BarcodeLabel } from './BarcodeLabel';
import { QRCodeLabel } from './QRCodeLabel';

interface Props {
  label: LabelData;
  code: GeneratedCode;
}

/**
 * The PRINT copy of the label: the same label components and the same label data and generated
 * code as the on-screen preview, rendered at the real label size in a container attached to
 * <body> (outside the app). It is hidden on screen; while a label print is in progress the print
 * stylesheet hides the app and shows only this. The data-* attributes let the print service check
 * that the right, fully-rendered label is present before it opens the print dialog.
 */
export function PrintableLabel({ label, code }: Props) {
  // If the label goes away while a print is "in progress", drop the print-only state with it.
  useEffect(() => () => endLabelPrint(), []);

  if (typeof document === 'undefined') return null; // server-side/static rendering

  return createPortal(
    <div
      className={PRINT_ROOT_CLASS}
      data-print-ready="true"
      data-serial={label.serial}
      data-code-kind={code.kind}
      data-code-value={code.value}
      aria-hidden="true"
    >
      {code.kind === 'barcode' ? (
        <BarcodeLabel label={label} code={code} mode="print" />
      ) : (
        <QRCodeLabel label={label} code={code} mode="print" />
      )}
    </div>,
    document.body,
  );
}
