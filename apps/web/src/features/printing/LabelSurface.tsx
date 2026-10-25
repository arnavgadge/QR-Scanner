import type { CSSProperties, ReactNode } from 'react';
import { LABEL_PREVIEW_MAX_WIDTH_PX, LABEL_SIZE_MM } from '../../config/label';

export type LabelMode = 'preview' | 'print';

interface Props {
  children: ReactNode;
  codeType: string;
  /**
   * 'preview' (default): responsive on-screen label.
   * 'print': the real label size in millimetres (LABEL_SIZE_MM), no screen-only border, used by
   * the print copy. Everything inside is sized in `cqw` (percent of THIS element's width), so
   * both modes share the exact same label markup and look identical apart from size.
   */
  mode?: LabelMode;
  testId?: string;
  /** Paper size; default LABEL_SIZE_MM (a company may have its own label stock). */
  sizeMm?: { width: number; height: number };
}

/** The label's paper: fixed aspect ratio, white, with the container-query context for cqw units. */
export function LabelSurface({
  children,
  codeType,
  mode = 'preview',
  testId,
  sizeMm = LABEL_SIZE_MM,
}: Props) {
  const isPrint = mode === 'print';
  const style: CSSProperties = isPrint
    ? {
        containerType: 'inline-size',
        width: `${sizeMm.width}mm`,
        height: `${sizeMm.height}mm`,
      }
    : {
        containerType: 'inline-size',
        aspectRatio: `${sizeMm.width} / ${sizeMm.height}`,
        width: '100%',
        maxWidth: LABEL_PREVIEW_MAX_WIDTH_PX,
      };
  return (
    <div
      data-testid={testId ?? (isPrint ? 'print-label' : 'label')}
      data-code-type={codeType}
      data-label-mode={mode}
      style={style}
      className={
        isPrint
          ? 'overflow-hidden bg-white text-black'
          : 'overflow-hidden rounded-md border-2 border-ink bg-white text-black'
      }
    >
      {children}
    </div>
  );
}
