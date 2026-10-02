import type { RegisterSerialInput, RegisterSerialOutcome, SerialService } from './index';

/**
 * DEVELOPMENT-ONLY in-memory stand-in for the Firestore-backed SerialService.
 * State lives in this tab only and resets on reload. Replaced in Phases 3-4.
 */
const registered = new Set<string>(['VC-000001', 'VC-000002']);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MOCK_DUPLICATE_EXAMPLE = 'VC-000001';

export const mockSerialService: SerialService = {
  normalize: (raw) => raw.trim().toUpperCase().replace(/\s+/g, ''),

  async validate(serial) {
    const normalized = mockSerialService.normalize(serial);
    // Real company-specific format rules arrive in Phase 3.
    return normalized
      ? { valid: true, normalized }
      : { valid: false, normalized, error: 'Enter a serial number.' };
  },

  async register(input: RegisterSerialInput): Promise<RegisterSerialOutcome> {
    await delay(600);
    const serial = mockSerialService.normalize(input.serial);
    if (registered.has(serial)) return { result: 'duplicate' };
    registered.add(serial);
    return { result: 'new' };
  },
};
