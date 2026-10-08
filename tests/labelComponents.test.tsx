import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LabelPreview } from '../src/features/printing';
import { ResultPanel } from '../src/features/operator/ResultPanel';
import type { DuplicateSerialResult, NewSerialResult } from '../src/services/serial';
import type { Company } from '../src/types';

const company = (id: string, name: string, codeType: Company['codeType']): Company => ({
  id,
  name,
  codeType,
  serialFormat: '',
  active: true,
  createdAt: null,
  updatedAt: null,
});
const newResult = (serial: string, c: Company, partNo = ''): NewSerialResult => ({
  result: 'new',
  serial,
  company: c,
  partNo,
  source: 'manual',
  scannedBy: 'u1',
  scannedByName: 'Oli',
  scannedAt: '2026-10-04T10:00:00.000Z',
});

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('LabelPreview chooses the label from the COMPANY configuration', () => {
  it('barcode company -> BarcodeLabel: Code 128 bars, human-readable serial, NO QR', () => {
    const out = html(
      <LabelPreview
        result={newResult('TEST-BARCODE-001', company('a', 'Company A', 'barcode'), 'PN-7')}
      />,
    );
    expect(out).toContain('data-code-type="barcode"');
    expect(out).toContain('data-code-kind="barcode"');
    expect(out).toContain('data-code-value="TEST-BARCODE-001"');
    expect(out).not.toContain('data-code-kind="qr"');
    expect(out).not.toContain('data-code-type="qr"');
    expect(out).toContain('Part No: PN-7');
    expect(out).toContain('Company A');
    expect(out).toMatch(/data-testid="label-serial"[^>]*>TEST-BARCODE-001</); // real text, not only an image
    expect(out).toContain('Ready for printing');
  });

  it('QR company -> QRCodeLabel: QR matrix, human-readable serial, NO barcode', () => {
    const out = html(
      <LabelPreview result={newResult('TEST-QR-001', company('b', 'Company B', 'qr'))} />,
    );
    expect(out).toContain('data-code-type="qr"');
    expect(out).toContain('data-code-kind="qr"');
    expect(out).toContain('data-code-value="TEST-QR-001"');
    expect(out).not.toContain('data-code-kind="barcode"');
    expect(out).not.toContain('data-code-type="barcode"');
    expect(out).toMatch(/data-testid="label-serial"[^>]*>TEST-QR-001</);
    expect(out).toContain('Part No: —'); // no part number known: shown as "—", never invented
  });

  it('the label uses the verified timestamp from the result', () => {
    const out = html(
      <LabelPreview result={newResult('ABC123456', company('a', 'Company A', 'barcode'))} />,
    );
    expect(out).toContain('data-testid="label-time"');
  });

  it.each([null, 'hologram' as never])(
    'code type %j -> configuration error, no label, no code',
    (ct) => {
      const out = html(
        <LabelPreview result={newResult('ABC123456', company('x', 'Broken Co', ct))} />,
      );
      expect(out).toContain('Company code type is not configured.');
      expect(out).toContain('data-testid="label-config-error"');
      expect(out).not.toContain('data-testid="code-svg"');
      expect(out).not.toContain('data-testid="label"');
      expect(out).not.toContain('Ready for printing');
    },
  );

  it('code generation failure -> "Unable to generate label code." + Retry; never "ready"; serial kept as text', () => {
    // a barcode cannot encode non-ASCII characters
    const out = html(
      <LabelPreview result={newResult('ÄÖ123456', company('a', 'Company A', 'barcode'))} />,
    );
    expect(out).toContain('Unable to generate label code.');
    expect(out).toContain('Retry');
    expect(out).toContain('ÄÖ123456');
    expect(out).toContain('does not register anything again');
    expect(out).not.toContain('Ready for printing');
    expect(out).not.toContain('data-testid="code-svg"');
  });

  it('exposes accessible descriptions while the serial stays real text', () => {
    const out = html(
      <LabelPreview result={newResult('ABC123456', company('a', 'Company A', 'barcode'))} />,
    );
    expect(out).toContain('aria-label="Barcode (Code 128) encoding ABC123456"');
    expect(out).toContain('role="img"');
  });
});

describe('a DUPLICATE result never produces a label', () => {
  it('ResultPanel for a duplicate renders no label preview, no code, no print control', () => {
    const c = company('a', 'Company A', 'barcode');
    const dup: DuplicateSerialResult = {
      result: 'duplicate',
      serial: 'ABC123456',
      company: c,
      existingRecord: {
        serial: 'ABC123456',
        partNo: '',
        company: 'Company A',
        companyId: 'a',
        source: 'manual',
        scannedAt: '2026-10-04T09:00:00.000Z',
        scannedBy: 'u0',
        scannedByName: 'Ola',
      },
      currentAttempt: {
        scannedBy: 'u1',
        scannedByName: 'Oli',
        timestamp: '2026-10-04T10:00:00.000Z',
      },
    };
    const out = html(
      <ResultPanel result={dup} nextRef={{ current: null }} onNext={() => undefined} />,
    );
    expect(out).toContain('Duplicate Serial');
    expect(out).toContain('Send for re-engraving');
    expect(out).not.toContain('label-preview');
    expect(out).not.toContain('code-svg');
    expect(out).not.toContain('data-code-kind');
    expect(out).not.toContain('Print label');
    expect(out).not.toContain('Ready for printing');
  });

  it('ResultPanel for a NEW serial shows the label and an enabled Print Label button', () => {
    const out = html(
      <ResultPanel
        result={newResult('ABC123456', company('a', 'Company A', 'qr'))}
        nextRef={{ current: null }}
        onNext={() => undefined}
      />,
    );
    expect(out).toContain('New Serial Registered!');
    expect(out).toContain('data-testid="label-preview"');
    expect(out).toContain('data-testid="print-button"');
    expect(out).toContain('Print Label');
    expect(out).toContain('data-print-phase="ready"');
    expect(out).not.toMatch(/data-testid="print-button"[^>]*disabled/);
    expect(out).not.toContain('coming later');
  });

  it('a duplicate has NO print action at all', () => {
    const c = company('a', 'Company A', 'barcode');
    const dup: DuplicateSerialResult = {
      result: 'duplicate',
      serial: 'ABC123456',
      company: c,
      existingRecord: {
        serial: 'ABC123456',
        partNo: '',
        company: 'Company A',
        companyId: 'a',
        source: 'manual',
        scannedAt: '2026-10-04T09:00:00.000Z',
        scannedBy: 'u0',
        scannedByName: 'Ola',
      },
      currentAttempt: {
        scannedBy: 'u1',
        scannedByName: 'Oli',
        timestamp: '2026-10-04T10:00:00.000Z',
      },
    };
    const out = html(
      <ResultPanel result={dup} nextRef={{ current: null }} onNext={() => undefined} />,
    );
    for (const s of [
      'print-button',
      'print-controls',
      'Print Label',
      'Print Again',
      'label-print-root',
    ]) {
      expect(out).not.toContain(s);
    }
  });

  it('no print button when there is no label to print (configuration error / generation failure)', () => {
    const noType = html(
      <LabelPreview result={newResult('ABC123456', company('x', 'Broken Co', null))} />,
    );
    const failed = html(
      <LabelPreview result={newResult('ÄÖ123456', company('a', 'Company A', 'barcode'))} />,
    );
    for (const out of [noType, failed]) {
      expect(out).not.toContain('print-button');
      expect(out).not.toContain('Print Label');
    }
  });
});
