import { describe, expect, it } from 'vitest';
import { confidenceLevel, OCR_CONFIDENCE } from '../src/config/ocr';
import { cleanFragment, pickSerialCandidate } from '../src/services/ocr/candidate';
import { mockOcrService } from '../src/services/ocr/mockOcr';
import { OcrError, type OCRResult } from '../src/services/ocr/types';
import { validateSerialFormat } from '../src/services/serial/serialFormat';

const result = (
  text: string,
  candidates: { text: string; confidence?: number }[] = [],
  confidence?: number,
): OCRResult => ({
  text,
  rawText: text,
  provider: 'test',
  candidates,
  ...(confidence !== undefined ? { confidence } : {}),
});

describe('confidenceLevel (thresholds are configuration)', () => {
  it('classifies by the configured thresholds', () => {
    expect(confidenceLevel(OCR_CONFIDENCE.high)).toBe('high');
    expect(confidenceLevel(99)).toBe('high');
    expect(confidenceLevel(OCR_CONFIDENCE.high - 0.1)).toBe('medium');
    expect(confidenceLevel(OCR_CONFIDENCE.medium)).toBe('medium');
    expect(confidenceLevel(OCR_CONFIDENCE.medium - 0.1)).toBe('low');
    expect(confidenceLevel(0)).toBe('low');
  });
  it('is "unknown" when the engine reports nothing — never a made-up level', () => {
    expect(confidenceLevel(undefined)).toBe('unknown');
    expect(confidenceLevel(Number.NaN)).toBe('unknown');
  });
});

describe('cleanFragment', () => {
  it('strips spaces/punctuation and upper-cases, but never "corrects" look-alike characters', () => {
    expect(cleanFragment(' 13waa 000000401 ')).toBe('13WAA000000401');
    expect(cleanFragment('AB|C-123,')).toBe('ABC-123');
    expect(cleanFragment('-ABC123-')).toBe('ABC123');
    expect(cleanFragment('ABCI23')).toBe('ABCI23'); // I stays I
    expect(cleanFragment('0O0I1l')).toBe('0O0I1L'); // only case changes
  });
});

describe('pickSerialCandidate', () => {
  const fitsA = (t: string) => validateSerialFormat(t, '13WAA#########');

  it('prefers a fragment that fits the company format over a longer non-matching one', () => {
    const r = result('', [
      { text: 'MADEINGERMANY2026', confidence: 90 },
      { text: '13WAA000000401', confidence: 71 },
      { text: 'PN-5555', confidence: 88 },
    ]);
    const p = pickSerialCandidate(r, fitsA)!;
    expect(p.text).toBe('13WAA000000401');
    expect(p.confidence).toBe(71);
    expect(p.matchesFormat).toBe(true);
    expect(p.alternatives.map((a) => a.text)).toContain('MADEINGERMANY2026');
  });

  it('joins a serial split by a gap when the joined line is offered as a candidate', () => {
    const r = result('', [
      { text: '13WAA', confidence: 95 },
      { text: '000000401', confidence: 93 },
      { text: '13WAA 000000401', confidence: 90 }, // the whole line
    ]);
    expect(pickSerialCandidate(r, fitsA)?.text).toBe('13WAA000000401');
  });

  it('without a format, the longest plausible fragment wins; noise is ignored', () => {
    const r = result('', [
      { text: 'A', confidence: 99 },
      { text: ',', confidence: 3 },
      { text: 'AB-12345', confidence: 60 },
    ]);
    expect(pickSerialCandidate(r)).toMatchObject({ text: 'AB-12345', confidence: 60 });
    expect(pickSerialCandidate(r)?.matchesFormat).toBeUndefined();
  });

  it('flags a pick that does not fit the format (the operator must correct it)', () => {
    const p = pickSerialCandidate(result('', [{ text: 'ABCI23', confidence: 70 }]), fitsA)!;
    expect(p.text).toBe('ABCI23');
    expect(p.matchesFormat).toBe(false);
  });

  it('returns null when nothing usable was read', () => {
    expect(pickSerialCandidate(result(''))).toBeNull();
    expect(pickSerialCandidate(result('', [{ text: 'A' }, { text: ' , ' }]))).toBeNull();
  });

  it('does not invent a confidence when the engine gave none', () => {
    const p = pickSerialCandidate(result('', [{ text: 'ABC12345' }]))!;
    expect('confidence' in p).toBe(false);
  });
});

describe('mock OCR provider (development only) — scenarios by file name', () => {
  const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });

  it('high / medium / low / no-confidence readings', async () => {
    expect(await mockOcrService.recognize(file('mock-high-ABC123.png'))).toMatchObject({
      text: 'ABC123',
      confidence: 96,
    });
    expect(await mockOcrService.recognize(file('mock-medium-ABC123.png'))).toMatchObject({
      confidence: 75,
    });
    expect(await mockOcrService.recognize(file('mock-low-ABC123.png'))).toMatchObject({
      confidence: 40,
    });
    const nc = await mockOcrService.recognize(file('mock-noconf-ABC123.png'));
    expect(nc.text).toBe('ABC123');
    expect('confidence' in nc).toBe(false);
  });
  it('unreadable, noise and failure', async () => {
    expect((await mockOcrService.recognize(file('mock-none.png'))).candidates).toEqual([]);
    expect(pickSerialCandidate(await mockOcrService.recognize(file('mock-noise.png')))).toBeNull();
    await expect(mockOcrService.recognize(file('mock-error.png'))).rejects.toBeInstanceOf(OcrError);
  });
  it('can be cancelled', async () => {
    const ac = new AbortController();
    const p = mockOcrService.recognize(file('mock-slow-ABC123.png'), { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
  it('is labelled development-only', () => {
    expect(mockOcrService.provider).toMatch(/development only/);
  });
});
