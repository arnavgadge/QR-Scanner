import { describe, expect, it } from 'vitest';
import {
  buildBarcodeValue,
  buildLabelData,
  buildQrPayload,
  CodeGenerationError,
  codeToSvg,
  generateCode,
  generateLabelCode,
} from '../src/services/printing';
import type { NewSerialResult } from '../src/services/serial';
import type { Company } from '../src/types';
import { BarcodeFormat, decodeSvg } from './codeHelpers';

const SERIALS = [
  'TEST-BARCODE-001',
  'TEST-QR-001',
  '13WAA000000401',
  '27BXX0000001',
  'SERIAL-001',
  '0001234500', // leading zeros
  '12345678901234567890', // long numeric
  '1E5',
  'A',
  'AB-12',
];

describe('barcode generation (Code 128) — decoded with ZXing', () => {
  it('TEST-BARCODE-001 renders and decodes back to exactly TEST-BARCODE-001', () => {
    const code = generateCode({ codeType: 'barcode', value: 'TEST-BARCODE-001' });
    expect(code.kind).toBe('barcode');
    const decoded = decodeSvg(codeToSvg(code), [BarcodeFormat.CODE_128]);
    expect(decoded.text).toBe('TEST-BARCODE-001');
    expect(decoded.format).toBe(BarcodeFormat.CODE_128);
  });

  it.each(SERIALS)('round-trips %s', (serial) => {
    const code = generateCode({ codeType: 'barcode', value: serial });
    expect(decodeSvg(codeToSvg(code), [BarcodeFormat.CODE_128]).text).toBe(serial);
  });

  it('is a pure barcode: bars only, no QR data; honours the Code 128 quiet zone', () => {
    const code = generateCode({ codeType: 'barcode', value: 'ABC123' });
    if (code.kind !== 'barcode') throw new Error('expected barcode');
    expect('matrix' in code).toBe(false);
    expect('path' in code).toBe(false);
    expect(code.quietZone).toBeGreaterThanOrEqual(10);
    expect(code.bars[0]!.x).toBeGreaterThanOrEqual(code.quietZone);
    const last = code.bars[code.bars.length - 1]!;
    expect(last.x + last.width).toBeLessThanOrEqual(code.totalModules - code.quietZone);
  });
});

describe('QR generation — decoded with ZXing', () => {
  it('TEST-QR-001 renders and decodes back to exactly TEST-QR-001', () => {
    const code = generateCode({ codeType: 'qr', value: 'TEST-QR-001' });
    expect(code.kind).toBe('qr');
    const decoded = decodeSvg(codeToSvg(code), [BarcodeFormat.QR_CODE]);
    expect(decoded.text).toBe('TEST-QR-001');
    expect(decoded.format).toBe(BarcodeFormat.QR_CODE);
  });

  it.each(SERIALS)('round-trips %s', (serial) => {
    const code = generateCode({ codeType: 'qr', value: serial });
    expect(decodeSvg(codeToSvg(code), [BarcodeFormat.QR_CODE]).text).toBe(serial);
  });

  it('is a pure QR: square matrix with a 4-module quiet zone, no bars', () => {
    const code = generateCode({ codeType: 'qr', value: 'ABC123' });
    if (code.kind !== 'qr') throw new Error('expected qr');
    expect('bars' in code).toBe(false);
    expect(code.matrix.length).toBe(code.matrix[0]!.length);
    expect(code.quietZone).toBe(4);
    expect(code.size).toBe(code.matrix.length + 8);
  });

  it('the barcode decoder does not read a QR and vice versa (they are different codes)', () => {
    const qr = codeToSvg(generateCode({ codeType: 'qr', value: 'ABC123' }));
    expect(() => decodeSvg(qr, [BarcodeFormat.CODE_128])).toThrow();
    const bar = codeToSvg(generateCode({ codeType: 'barcode', value: 'ABC123' }));
    expect(() => decodeSvg(bar, [BarcodeFormat.QR_CODE])).toThrow();
  });
});

describe('generation is deterministic and failures are explicit', () => {
  it('same input -> identical output; different input -> different output', () => {
    const a = codeToSvg(generateCode({ codeType: 'qr', value: 'ABC123' }));
    expect(codeToSvg(generateCode({ codeType: 'qr', value: 'ABC123' }))).toBe(a);
    expect(codeToSvg(generateCode({ codeType: 'qr', value: 'ABC124' }))).not.toBe(a);
  });

  it('rejects empty/blank values, surrounding whitespace, non-ASCII barcodes, oversize and unknown types', () => {
    const reason = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof CodeGenerationError ? e.reason : 'other';
      }
      return 'no-error';
    };
    expect(reason(() => generateCode({ codeType: 'barcode', value: '' }))).toBe('invalid-value');
    expect(reason(() => generateCode({ codeType: 'qr', value: '   ' }))).toBe('invalid-value');
    expect(reason(() => generateCode({ codeType: 'qr', value: ' ABC ' }))).toBe('invalid-value');
    expect(reason(() => generateCode({ codeType: 'barcode', value: 'ÄÖ-123' }))).toBe(
      'unsupported-characters',
    );
    expect(reason(() => generateCode({ codeType: 'barcode', value: 'A'.repeat(200) }))).toBe(
      'invalid-value',
    );
    expect(reason(() => generateCode({ codeType: 'qr', value: 'A'.repeat(2000) }))).toBe(
      'invalid-value',
    );
    expect(reason(() => generateCode({ codeType: 'hologram' as never, value: 'ABC' }))).toBe(
      'unsupported-type',
    );
  });
});

describe('label data (derived from the verified result, not stored)', () => {
  const company = (codeType: Company['codeType']): Company => ({
    id: 'c1',
    name: 'Acme',
    codeType,
    serialFormat: '',
    active: true,
    createdAt: null,
    updatedAt: null,
  });
  const result = (codeType: Company['codeType']): NewSerialResult => ({
    result: 'new',
    serial: 'ABC123456',
    company: company(codeType),
    partNo: 'PN-7',
    source: 'manual',
    scannedBy: 'uid1',
    scannedByName: 'Oli',
    scannedAt: '2026-10-04T10:11:12.000Z',
  });

  it("uses the COMPANY's code type and the verified values (no new timestamp, no invented part number)", () => {
    const b = buildLabelData(result('barcode'));
    expect(b).toMatchObject({
      ok: true,
      label: {
        codeType: 'barcode',
        codeValue: 'ABC123456',
        serial: 'ABC123456',
        companyName: 'Acme',
        partNo: 'PN-7',
        scannedBy: 'Oli',
        timestamp: '2026-10-04T10:11:12.000Z',
      },
    });
    const q = buildLabelData(result('qr'));
    expect(q).toMatchObject({ ok: true, label: { codeType: 'qr', codeValue: 'ABC123456' } });
    expect(buildLabelData({ ...result('qr'), partNo: '' })).toMatchObject({
      ok: true,
      label: { partNo: '' },
    });
  });

  it('a company with no/unsupported code type yields a configuration error and NO label (no silent default)', () => {
    for (const ct of [null, 'hologram' as never, undefined as never]) {
      expect(buildLabelData(result(ct))).toEqual({
        ok: false,
        reason: 'code-type-not-configured',
        message: 'Company code type is not configured.',
      });
    }
  });

  it('payloads are isolated functions; the initial QR/barcode payload is the serial itself', () => {
    const src = { serial: 'ABC123456', companyId: 'c1', partNo: 'PN-7' };
    expect(buildBarcodeValue(src)).toBe('ABC123456');
    expect(buildQrPayload(src)).toBe('ABC123456');
  });

  it('switching company switches the generated code type, with nothing left over from before', () => {
    const a = buildLabelData(result('barcode'));
    const b = buildLabelData(result('qr'));
    if (!a.ok || !b.ok) throw new Error('expected labels');
    const ca = generateLabelCode(a.label);
    const cb = generateLabelCode(b.label);
    expect([ca.kind, cb.kind]).toEqual(['barcode', 'qr']);
    expect(decodeSvg(codeToSvg(ca), [BarcodeFormat.CODE_128]).text).toBe('ABC123456');
    expect(decodeSvg(codeToSvg(cb), [BarcodeFormat.QR_CODE]).text).toBe('ABC123456');
  });
});
