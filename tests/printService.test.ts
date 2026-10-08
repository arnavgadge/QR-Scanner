import { describe, expect, it, vi } from 'vitest';
import {
  endLabelPrint,
  PRINT_BODY_CLASS,
  PRINT_FAILED_MESSAGE,
  PrintError,
  printLabel,
  type LabelData,
  type PrintEnv,
} from '../src/services/printing';

const LABEL: LabelData = {
  serial: 'TEST-BARCODE-001',
  partNo: '',
  companyId: 'company-a',
  companyName: 'Company A',
  codeType: 'barcode',
  codeValue: 'TEST-BARCODE-001',
  scannedBy: 'Oli',
  timestamp: '2026-10-04T10:00:00.000Z',
};

interface Opts {
  root?: Record<string, string> | null;
  print?: (() => void) | undefined | 'missing';
  rootAttrs?: Partial<Record<'serial' | 'kind' | 'value' | 'ready', string>>;
}

/** A tiny fake browser: records class/style changes and the order of events. */
function fakeBrowser(opts: Opts = {}) {
  const events: string[] = [];
  const classes = new Set<string>();
  const styles: { id: string; textContent: string | null; removed: boolean }[] = [];
  const listeners: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const attrs: Record<string, string> | null =
    opts.root === null
      ? null
      : {
          'data-print-ready': 'true',
          'data-serial': LABEL.serial,
          'data-code-kind': LABEL.codeType,
          'data-code-value': LABEL.codeValue,
          ...(opts.root ?? {}),
        };
  const printFn =
    opts.print === 'missing'
      ? undefined
      : (opts.print ??
        (() => {
          events.push(
            `print (class=${classes.has(PRINT_BODY_CLASS)}, styles=${styles.filter((s) => !s.removed).length})`,
          );
        }));
  const env: PrintEnv = {
    document: {
      body: {
        classList: {
          add: (c) => void classes.add(c),
          remove: (c) => void classes.delete(c),
        },
      },
      head: { appendChild: (n) => void styles.push(n as (typeof styles)[number]) },
      createElement: () => {
        const el = {
          id: '',
          textContent: null as string | null,
          removed: false,
          remove() {
            el.removed = true;
          },
        };
        return el;
      },
      getElementById: (id) => {
        const s = styles.find((x) => x.id === id && !x.removed);
        return s ? { remove: () => void (s.removed = true) } : null;
      },
      querySelector: (sel) =>
        attrs && sel.includes('label-print-root') && attrs['data-print-ready'] === 'true'
          ? { getAttribute: (n: string) => attrs[n] ?? null }
          : null,
    },
    window: {
      ...(printFn ? { print: printFn } : {}),
      addEventListener: (_t, fn) => void listeners.push(fn),
      removeEventListener: (_t, fn) => void listeners.splice(listeners.indexOf(fn), 1),
      requestAnimationFrame: (cb) => (cb(), 0),
      setTimeout: (fn) => (timers.push(fn), timers.length),
      clearTimeout: () => undefined,
    },
  };
  return {
    env,
    events,
    classes,
    activeStyles: () => styles.filter((s) => !s.removed),
    fireAfterPrint: () => [...listeners].forEach((fn) => fn()),
    fireFallbackTimer: () => timers.forEach((fn) => fn()),
    listeners,
  };
}

describe('printLabel (browser print service)', () => {
  it('prepares the print layout, calls print() exactly once, then cleans up on afterprint', async () => {
    const b = fakeBrowser();
    await printLabel(LABEL, b.env);
    expect(b.events).toEqual(['print (class=true, styles=1)']); // layout was prepared BEFORE the dialog
    const css = b.activeStyles()[0]!.textContent;
    expect(css).toBe('@page { size: 70mm 35mm; margin: 0; }'); // label size from config, no margins
    expect(b.classes.has(PRINT_BODY_CLASS)).toBe(true); // stays until the dialog is done
    b.fireAfterPrint();
    expect(b.classes.has(PRINT_BODY_CLASS)).toBe(false);
    expect(b.activeStyles()).toHaveLength(0);
  });

  it('refuses to print without label data (no print dialog, no print layout left behind)', async () => {
    for (const bad of [
      null,
      undefined,
      { ...LABEL, serial: '' },
      { ...LABEL, codeValue: '' },
      { ...LABEL, codeType: 'hologram' as never },
    ]) {
      const b = fakeBrowser();
      await expect(printLabel(bad as LabelData, b.env)).rejects.toMatchObject({ code: 'no-label' });
      expect(b.events).toEqual([]);
      expect(b.classes.size).toBe(0);
    }
  });

  it('refuses to print when the code has not been rendered for printing, or is another label’s', async () => {
    const cases: Opts[] = [
      { root: null },
      { root: { 'data-print-ready': 'false' } },
      { root: { 'data-serial': 'OTHER-1' } },
      { root: { 'data-code-kind': 'qr' } },
      { root: { 'data-code-value': 'SOMETHING-ELSE' } },
    ];
    for (const c of cases) {
      const b = fakeBrowser(c);
      await expect(printLabel(LABEL, b.env)).rejects.toMatchObject({ code: 'not-rendered' });
      expect(b.events).toEqual([]);
      expect(b.classes.size).toBe(0);
    }
  });

  it('reports when the browser print API is unavailable', async () => {
    const b = fakeBrowser({ print: 'missing' });
    await expect(printLabel(LABEL, b.env)).rejects.toMatchObject({ code: 'api-unavailable' });
    expect(b.classes.size).toBe(0);
  });

  it('an unexpected print() failure is a PrintError and leaves no print state behind', async () => {
    const b = fakeBrowser({
      print: () => {
        throw new Error('boom');
      },
    });
    const err = await printLabel(LABEL, b.env).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrintError);
    expect((err as PrintError).code).toBe('failed');
    expect((err as PrintError).message).toBe(PRINT_FAILED_MESSAGE);
    expect(b.classes.size).toBe(0);
    expect(b.activeStyles()).toHaveLength(0);
  });

  it('Print Again: printing the same label twice opens the dialog twice with a single layout style', async () => {
    const b = fakeBrowser();
    await printLabel(LABEL, b.env);
    b.fireAfterPrint();
    await printLabel(LABEL, b.env);
    expect(b.events).toHaveLength(2);
    expect(b.activeStyles()).toHaveLength(1);
    // and even without afterprint in between, a second call replaces (never stacks) the first state
    await printLabel(LABEL, b.env);
    expect(b.events).toHaveLength(3);
    expect(b.activeStyles()).toHaveLength(1);
    expect(b.listeners).toHaveLength(1);
  });

  it('a browser that never fires afterprint does not leave the print layout on forever', async () => {
    const b = fakeBrowser();
    await printLabel(LABEL, b.env);
    b.fireFallbackTimer();
    expect(b.classes.has(PRINT_BODY_CLASS)).toBe(false);
    expect(b.activeStyles()).toHaveLength(0);
  });

  it('endLabelPrint removes the print state on demand (e.g. when the label is removed)', async () => {
    const b = fakeBrowser();
    await printLabel(LABEL, b.env);
    endLabelPrint();
    expect(b.classes.has(PRINT_BODY_CLASS)).toBe(false);
    expect(b.activeStyles()).toHaveLength(0);
  });

  it('never needs Firestore: it only works with the document and window it is given', async () => {
    const spy = vi.fn();
    const b = fakeBrowser({ print: spy });
    await printLabel(LABEL, b.env);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
