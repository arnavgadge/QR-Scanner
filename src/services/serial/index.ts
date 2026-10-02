import type { CodeType, ScanResult, SerialRecord, SerialSource } from '../../types';

/** Boundary for serial logic. Implemented in Phases 3-4; no implementation in Phase 0. */
export interface SerialValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

export interface RegisterSerialInput {
  serial: string;
  partNumber: string;
  companyId: string;
  source: SerialSource;
}

export interface RegisterSerialOutcome {
  result: ScanResult;
  record?: SerialRecord;
  codeType?: CodeType;
}

export interface SerialService {
  normalize(raw: string): string;
  validate(serial: string, companyId: string): Promise<SerialValidationResult>;
  /** Must be atomic (single Firestore transaction) so concurrent devices cannot double-register. */
  register(input: RegisterSerialInput): Promise<RegisterSerialOutcome>;
}
