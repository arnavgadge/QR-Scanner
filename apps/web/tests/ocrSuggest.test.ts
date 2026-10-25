import { describe, expect, it } from 'vitest';
import { pickSerialCandidate } from '../src/services/ocr/candidate';
import { suggestFormatCorrection } from '../src/services/serial/serialFormat';

const A = '13WAA#########';

describe('suggestFormatCorrection (a suggestion, never applied automatically)', () => {
  it('fixes a letter O / I where the format requires a digit', () => {
    expect(suggestFormatCorrection('13WAAO00000401', A)).toBe('13WAA000000401');
    expect(suggestFormatCorrection('13WAA00000040I', A)).toBe('13WAA000000401');
    expect(suggestFormatCorrection('13WAAOOOOOO40I', A)).toBe('13WAA000000401');
  });
  it('fixes a digit where the format has a literal letter', () => {
    // format "OSB-###": the engraving's letter O read as 0, S as 5, B as 8
    expect(suggestFormatCorrection('05B-123', 'OSB-###')).toBe('OSB-123');
    expect(suggestFormatCorrection('OS8-123', 'OSB-###')).toBe('OSB-123');
  });
  it('gives no suggestion for an already-valid serial, or a mismatch that is not a known look-alike', () => {
    expect(suggestFormatCorrection('13WAA000000401', A)).toBeNull(); // already valid
    expect(suggestFormatCorrection('14WAA000000401', A)).toBeNull(); // 4 is not a look-alike of 3
    expect(suggestFormatCorrection('13WAA00000040X', A)).toBeNull(); // X is not a look-alike of a digit
  });
  it('gives nothing when the length is wrong or a mismatch is not a known look-alike', () => {
    expect(suggestFormatCorrection('13WAA00000040', A)).toBeNull(); // too short
    expect(suggestFormatCorrection('13WAA0P0000401', A)).toBeNull(); // P is not a look-alike of a digit
    expect(suggestFormatCorrection('ANYTHING', '')).toBeNull(); // no format
  });
});

describe('pickSerialCandidate ranking without a company format', () => {
  const r = (list: [string, number][]) => ({
    text: '',
    rawText: '',
    provider: 't',
    candidates: list.map(([text, confidence]) => ({ text, confidence })),
  });
  it('prefers a mixed letters+digits serial over plain words, and drops merged lines', () => {
    const p = pickSerialCandidate(
      r([
        ['MADE IN GERMANY', 90],
        ['PART NO 5555-221 MAX 250 BAR 2026-10 13WAA000000401 EXTRA STUFF', 80], // merged line (> 40)
        ['13WAA000000401', 85],
        ['PLAINWORDS', 95],
      ]),
    )!;
    expect(p.text).toBe('13WAA000000401');
    expect(p.alternatives.every((a) => a.text.length <= 40)).toBe(true);
  });
});
