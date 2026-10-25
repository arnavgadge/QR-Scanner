import { describe, expect, it } from 'vitest';
import { ocrFormatFeedback, validateSerialFormat } from '../src/services/serial/serialFormat';
import { normalizeSerial } from '../src/utils/serial';

describe('validateSerialFormat', () => {
  it('Company A pattern: literals + digits, exact length', () => {
    const f = '13WAA#########';
    expect(validateSerialFormat('13WAA000000001', f)).toBe(true);
    expect(validateSerialFormat('13WAA00000000', f)).toBe(false); // too short
    expect(validateSerialFormat('13WAA0000000011', f)).toBe(false); // too long
    expect(validateSerialFormat('14WAA000000001', f)).toBe(false); // wrong prefix
    expect(validateSerialFormat('13WAA00000000A', f)).toBe(false); // letter where digit required
  });
  it('Company B pattern', () => {
    expect(validateSerialFormat('27BXX0000001', '27BXX#######')).toBe(true);
    expect(validateSerialFormat('27BXX000000', '27BXX#######')).toBe(false);
  });
  it('empty pattern accepts any non-empty serial', () => {
    expect(validateSerialFormat('ANYTHING-1', '')).toBe(true);
    expect(validateSerialFormat('', '')).toBe(false);
  });
});

describe('normalizeSerial', () => {
  it('trims and upper-cases but never touches look-alike characters', () => {
    expect(normalizeSerial('  13waa000000001\t')).toBe('13WAA000000001');
    expect(normalizeSerial('O0I1')).toBe('O0I1');
  });
  it('does not alter inner characters', () => {
    expect(normalizeSerial('AB CD')).toBe('AB CD');
  });
});

describe('ocrFormatFeedback (live feedback for the company selected NOW)', () => {
  it('flags a reading that does not fit the CURRENT company format, and clears when the company fits', () => {
    expect(ocrFormatFeedback('13WAA000000611', '13WAA000000611', '27BXX#######').mismatch).toBe(
      true,
    );
    expect(ocrFormatFeedback('13WAA000000611', '13WAA000000611', '13WAA#########').mismatch).toBe(
      false,
    );
  });
  it('re-evaluates the edited text, not the original reading', () => {
    expect(ocrFormatFeedback('13WAAO00000612', '13WAAO00000612', '13WAA#########').mismatch).toBe(
      true,
    );
    expect(ocrFormatFeedback('13WAA000000612', '13WAAO00000612', '13WAA#########').mismatch).toBe(
      false,
    );
  });
  it('offers the look-alike fix for the original reading until the field already holds it', () => {
    expect(ocrFormatFeedback('13WAAO00000612', '13WAAO00000612', '13WAA#########').suggestion).toBe(
      '13WAA000000612',
    );
    expect(
      ocrFormatFeedback('13WAA000000612', '13WAAO00000612', '13WAA#########').suggestion,
    ).toBeNull();
  });
  it('a company without a format never mismatches and has no suggestion; an empty field is not a mismatch', () => {
    expect(ocrFormatFeedback('ANYTHING', 'ANYTHING', '')).toEqual({
      mismatch: false,
      suggestion: null,
    });
    expect(ocrFormatFeedback('', 'X', 'AB##').mismatch).toBe(false);
  });
});
