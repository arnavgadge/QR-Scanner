import type { GeneratedCode } from '../../services/printing';

interface Props {
  code: GeneratedCode;
  /** Accessible description; the human-readable value is always also shown as real text. */
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders a generated barcode/QR as inline SVG (vector, so it stays sharp at any size and prints
 * unchanged later). All geometry comes from the code generator; no encoding logic lives here.
 */
export function CodeSvg({ code, label, className, style }: Props) {
  if (code.kind === 'barcode') {
    const h = 40;
    return (
      <svg
        role="img"
        aria-label={label}
        data-testid="code-svg"
        data-code-kind="barcode"
        data-code-value={code.value}
        viewBox={`0 0 ${code.totalModules} ${h}`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        className={className}
        style={style}
      >
        <rect width={code.totalModules} height={h} fill="#fff" />
        <g fill="#000">
          {code.bars.map((b) => (
            <rect key={b.x} x={b.x} y={0} width={b.width} height={h} />
          ))}
        </g>
      </svg>
    );
  }
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="code-svg"
      data-code-kind="qr"
      data-code-value={code.value}
      viewBox={`0 0 ${code.size} ${code.size}`}
      shapeRendering="crispEdges"
      className={className}
      style={style}
    >
      <rect width={code.size} height={code.size} fill="#fff" />
      <path fill="#000" d={code.path} />
    </svg>
  );
}
