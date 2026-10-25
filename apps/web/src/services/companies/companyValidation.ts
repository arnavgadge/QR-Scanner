import { msg, type Msg } from '../../i18n/core';
import type { CodeType } from '../../types';

/** What the admin form edits. */
export interface CompanyInput {
  name: string;
  codeType: CodeType | '';
  serialFormat: string;
  active: boolean;
  /** Label size in mm as typed (desktop only; '' or absent = default label size). */
  labelWidthMm?: string;
  labelHeightMm?: string;
}

export type CompanyField = 'name' | 'codeType' | 'serialFormat' | 'labelSize';
export type CompanyErrors = Partial<Record<CompanyField, Msg>>;

export const COMPANY_NAME_MAX = 80;
export const SERIAL_FORMAT_MAX = 100;

/**
 * A serial format may contain only capital letters A-Z, digits 0-9 and '#' (one digit): the same
 * characters an operator can type into the serial field, so every configured format is enterable.
 */
export const SERIAL_FORMAT_PATTERN = /^[A-Z0-9#]+$/;

/**
 * Admin-facing validation for company configuration (create and edit). The serial format is
 * REQUIRED here: an empty format accepts any serial, which is only tolerated for legacy data.
 * The Firestore rules re-check the essentials independently.
 */
export function validateCompanyInput(input: CompanyInput): CompanyErrors {
  const errors: CompanyErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = msg('companies.nameRequired');
  else if (name.length > COMPANY_NAME_MAX) {
    errors.name = msg('companies.nameTooLong', { max: COMPANY_NAME_MAX });
  }
  if (input.codeType !== 'barcode' && input.codeType !== 'qr') {
    errors.codeType = msg('companies.codeTypeRequired');
  }
  const format = input.serialFormat.trim();
  if (!format) {
    errors.serialFormat = msg('companies.formatRequired');
  } else if (format.length > SERIAL_FORMAT_MAX) {
    errors.serialFormat = msg('companies.formatTooLong', { max: SERIAL_FORMAT_MAX });
  } else if (!SERIAL_FORMAT_PATTERN.test(format)) {
    errors.serialFormat = msg('companies.formatInvalid');
  }
  const width = input.labelWidthMm?.trim() ?? '';
  const height = input.labelHeightMm?.trim() ?? '';
  if ((width || height) && !(labelMm(width) && labelMm(height))) {
    errors.labelSize = msg('companies.labelSizeInvalid', {
      min: LABEL_MM_MIN,
      max: LABEL_MM_MAX,
    });
  }
  return errors;
}

/** Accepted label stock sizes (mm), for each side. */
export const LABEL_MM_MIN = 15;
export const LABEL_MM_MAX = 200;

/** A label side in mm, or null if not a sensible number. */
export function labelMm(text: string): number | null {
  if (!/^\d{1,3}(\.\d)?$/.test(text)) return null;
  const n = Number(text);
  return n >= LABEL_MM_MIN && n <= LABEL_MM_MAX ? n : null;
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
