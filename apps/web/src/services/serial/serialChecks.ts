/*
 * Pure serial rules shared by every backend (no database access), so the desktop server can use
 * them without bundling the Firebase-backed verification service.
 */
import { enText, msg, type Msg } from '../../i18n/core';
import type { Company } from '../../types';
import { describeSerialFormatMsg, labelCodeProblemMsg, validateSerialFormat } from './serialFormat';
import { serialValueProblem } from './serialValidation';
import type { InvalidSerialResult, VerificationErrorResult } from './serialVerification';

/** `message` (English) and `msg` (translatable) for a result. */
const text = (m: Msg) => ({ message: enText(m), msg: m });

/**
 * Every rule a serial must pass for `company` before anything is written, in order: company
 * available, code type configured, serial format, storable value, encodable on the company's
 * label. Pure and shared by every backend (Firebase here, the desktop server), so manual entry, OCR
 * and both backends refuse exactly the same serials with exactly the same messages.
 * Returns null when the serial may be registered.
 */
export function checkSerialForCompany(
  serial: string,
  company: Company | null,
): InvalidSerialResult | VerificationErrorResult | null {
  if (!company || !company.active) {
    return {
      result: 'error',
      code: 'company-unavailable',
      ...text(msg('verify.companyUnavailable')),
    };
  }

  // A company without a valid code type cannot produce a label, so nothing is registered for it:
  // otherwise a serial would be consumed with no way to label it. (Checked before any write.)
  if (company.codeType !== 'barcode' && company.codeType !== 'qr') {
    return {
      result: 'error',
      code: 'code-type-not-configured',
      ...text(msg('verify.codeTypeNotConfigured')),
    };
  }

  if (!validateSerialFormat(serial, company.serialFormat)) {
    return {
      result: 'invalid',
      serial,
      reason: 'format',
      ...text(
        msg('verify.invalidFormat', {
          company: company.name,
          format: describeSerialFormatMsg(company.serialFormat),
        }),
      ),
    };
  }

  // Shared value rules (length, storable as a document ID): identical for manual, OCR and Excel.
  const valueProblem = serialValueProblem(serial);
  if (valueProblem) {
    return {
      result: 'invalid',
      serial,
      reason: valueProblem.code === 'too-long' ? 'length' : 'characters',
      ...text(valueProblem.msg),
    };
  }

  // A serial the company's label cannot encode must not be registered (it would be consumed with no
  // way to label it): same philosophy as the "code type not configured" check above.
  const codeProblem = labelCodeProblemMsg(company.codeType, serial);
  if (codeProblem) {
    return {
      result: 'invalid',
      serial,
      reason: 'characters',
      ...text(msg('verify.cannotLabel', { problem: codeProblem, company: company.name })),
    };
  }

  return null;
}
