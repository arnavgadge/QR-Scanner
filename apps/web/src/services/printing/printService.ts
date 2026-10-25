import { labelSizeOf, type LabelData } from './labelData';
import { pageCss } from './printLayout';

/**
 * The ONLY place that calls the browser's print function (window.print). UI code calls
 * `printLabel`; it never calls window.print itself.
 *
 * How "print only the label" works: the label is also rendered once, outside the app, in a
 * hidden `.label-print-root` element (see features/printing/PrintableLabel). While a label print
 * is in progress the body carries the class `label-printing`; the print stylesheet
 * (styles/print.css) hides everything except that element, and a temporary @page rule sets the
 * page to the label size with no margins. Both are removed again on `afterprint`.
 * Nothing here touches Firestore: printing is output only.
 *
 * The browser cannot tell us whether a printer actually printed anything. `printLabel` resolves
 * when the print dialog has been requested (or has closed), never when paper came out.
 *
 * Desktop app: the same print layout is printed SILENTLY on the station's chosen printer by the
 * Electron main process (no dialog, no browser headers or footers), at the label's paper size.
 */

export const PRINT_FAILED_MESSAGE = 'Unable to prepare label for printing.';

export type PrintErrorCode =
  'no-label' | 'not-rendered' | 'api-unavailable' | 'no-printer' | 'failed';

export class PrintError extends Error {
  readonly code: PrintErrorCode;
  constructor(code: PrintErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PrintError';
    this.code = code;
  }
}

export const PRINT_BODY_CLASS = 'label-printing';
export const PRINT_ROOT_CLASS = 'label-print-root';
const PAGE_STYLE_ID = 'label-print-page-style';
/** If the browser never reports `afterprint`, drop the print-only state after this long. */
const CLEANUP_FALLBACK_MS = 5 * 60 * 1000;

/** The small slice of the browser this service needs (injectable for tests). */
export interface PrintEnv {
  document: {
    body: { classList: { add(c: string): void; remove(c: string): void } };
    head: { appendChild(node: unknown): unknown };
    createElement(tag: string): { id: string; textContent: string | null; remove(): void };
    getElementById(id: string): { remove(): void } | null;
    querySelector(selector: string): {
      getAttribute(name: string): string | null;
    } | null;
  };
  window: {
    print?: () => void;
    addEventListener(type: 'afterprint', fn: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'afterprint', fn: () => void): void;
    requestAnimationFrame?: (cb: () => void) => number;
    /** Desktop app only: silent print of the current print layout on the station's printer. */
    desktopPrint?: (sizeMm: {
      width: number;
      height: number;
    }) => Promise<{ ok: true } | { ok: false; error: { msg?: { key: string } } }>;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(id: unknown): void;
  };
}

function browserEnv(): PrintEnv {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new PrintError('api-unavailable', 'Printing is not available here.');
  }
  const bridge = (
    window as { desktop?: { printLabel: NonNullable<PrintEnv['window']['desktopPrint']> } }
  ).desktop;
  return {
    document,
    window: {
      print: window.print?.bind(window),
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      requestAnimationFrame: window.requestAnimationFrame?.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      ...(bridge
        ? { desktopPrint: (size: { width: number; height: number }) => bridge.printLabel(size) }
        : {}),
    },
  } as unknown as PrintEnv;
}

let pendingCleanup: (() => void) | null = null;

/** Removes the print-only state (body class + @page rule). Safe to call at any time. */
export function endLabelPrint(): void {
  pendingCleanup?.();
}

/** Throws unless the label data and its rendered print copy both exist and agree. */
function assertReady(label: LabelData | null | undefined, env: PrintEnv): void {
  if (
    !label ||
    !label.serial ||
    !label.codeValue ||
    (label.codeType !== 'barcode' && label.codeType !== 'qr')
  ) {
    throw new PrintError('no-label', 'There is no label to print.');
  }
  const root = env.document.querySelector(`.${PRINT_ROOT_CLASS}[data-print-ready="true"]`);
  if (
    !root ||
    root.getAttribute('data-serial') !== label.serial ||
    root.getAttribute('data-code-kind') !== label.codeType ||
    root.getAttribute('data-code-value') !== label.codeValue
  ) {
    // The code has not been rendered into the print copy (or it is a different label's copy).
    throw new PrintError('not-rendered', 'The label code has not been rendered for printing.');
  }
  if (typeof env.window.print !== 'function' && !env.window.desktopPrint) {
    throw new PrintError('api-unavailable', 'Printing is not available in this browser.');
  }
}

const nextFrames = (win: PrintEnv['window'], frames = 2) =>
  new Promise<void>((resolve) => {
    const raf = win.requestAnimationFrame;
    if (!raf) return resolve(void win.setTimeout(resolve, 0));
    const step = (n: number) => (n <= 0 ? resolve() : void raf.call(win, () => step(n - 1)));
    step(frames);
  });

/**
 * Opens the browser print dialog for an already-registered, already-rendered label. Never
 * registers or looks anything up; calling it again ("Print Again") simply prints again.
 */
export async function printLabel(
  label: LabelData | null | undefined,
  env?: PrintEnv,
): Promise<void> {
  const e = env ?? browserEnv();
  assertReady(label, e);

  endLabelPrint(); // a previous print's leftovers must not leak into this one

  const style = e.document.createElement('style');
  style.id = PAGE_STYLE_ID;
  const size = labelSizeOf(label as LabelData);
  style.textContent = pageCss(size);
  e.document.head.appendChild(style);
  e.document.body.classList.add(PRINT_BODY_CLASS);

  const fallback: { id: unknown } = { id: undefined };
  const cleanup = () => {
    e.window.removeEventListener('afterprint', cleanup);
    e.window.clearTimeout(fallback.id);
    e.document.body.classList.remove(PRINT_BODY_CLASS);
    e.document.getElementById(PAGE_STYLE_ID)?.remove();
    if (pendingCleanup === cleanup) pendingCleanup = null;
  };
  pendingCleanup = cleanup;
  e.window.addEventListener('afterprint', cleanup, { once: true });
  fallback.id = e.window.setTimeout(cleanup, CLEANUP_FALLBACK_MS);

  const silent = e.window.desktopPrint;
  if (silent) {
    let result;
    try {
      await nextFrames(e.window); // let the print layout be laid out before it is printed
      result = await silent(size);
    } catch (err) {
      cleanup();
      throw new PrintError('failed', PRINT_FAILED_MESSAGE, { cause: err });
    }
    cleanup(); // silent printing has finished with the layout
    if (!result.ok) {
      throw new PrintError(
        result.error.msg?.key === 'print.noPrinter' ? 'no-printer' : 'failed',
        PRINT_FAILED_MESSAGE,
      );
    }
    return;
  }

  try {
    await nextFrames(e.window); // let the print layout be laid out before the dialog snapshots it
    e.window.print?.();
  } catch (err) {
    cleanup();
    throw new PrintError('failed', PRINT_FAILED_MESSAGE, { cause: err });
  }
}
