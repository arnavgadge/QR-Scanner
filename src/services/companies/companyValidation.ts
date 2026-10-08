import type { CodeType } from '../../types';

/** What the admin form edits. */
export interface CompanyInput {
  name: string;
  codeType: CodeType | '';
  serialFormat: string;
  active: boolean;
}

export type CompanyField = 'name' | 'codeType' | 'serialFormat';
export type CompanyErrors = Partial<Record<CompanyField, string>>;

export const COMPANY_NAME_MAX = 80;
export const SERIAL_FORMAT_MAX = 100;

/**
 * Admin-facing validation for company configuration (create and edit). The serial format is
 * REQUIRED here: an empty format accepts any serial, which is only tolerated for legacy data.
 * The Firestore rules re-check the essentials independently.
 */
export function validateCompanyInput(input: CompanyInput): CompanyErrors {
  const errors: CompanyErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = 'Company name is required.';
  else if (name.length > COMPANY_NAME_MAX) {
    errors.name = `Company name must be at most ${COMPANY_NAME_MAX} characters.`;
  }
  if (input.codeType !== 'barcode' && input.codeType !== 'qr') {
    errors.codeType = 'Choose a label code type (Barcode or QR code).';
  }
  const format = input.serialFormat.trim();
  if (!format) {
    errors.serialFormat = 'Serial format is required (use # for a digit, e.g. 13WAA#########).';
  } else if (format.length > SERIAL_FORMAT_MAX) {
    errors.serialFormat = `Serial format must be at most ${SERIAL_FORMAT_MAX} characters.`;
  } else if (/[\s/]/.test(format)) {
    errors.serialFormat = 'Serial format cannot contain spaces or "/".';
  }
  return errors;
}

/** Document ID for a new company, derived from its name ("Acme Co." -> "acme-co"). */
export function companyIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug;
}
