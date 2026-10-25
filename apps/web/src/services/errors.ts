import { enText, isMsg, msg, type Msg, type Text } from '../i18n/core';

import { logError } from '../utils/log';
export type AppErrorCode =
  | 'config'
  | 'invalid-credentials'
  | 'permission-denied'
  | 'network'
  | 'not-found'
  | 'invalid-data'
  /** Desktop: the main computer (server) cannot be reached. */
  | 'server-unreachable'
  /** Desktop: app versions differ between this computer and the main computer. */
  | 'update-required'
  /** Desktop: the operator's sign-in expired (end of shift). */
  | 'session-expired'
  /** Desktop: this computer was removed from the system by an administrator. */
  | 'revoked'
  /** Desktop: pairing refused for a few minutes after too many wrong codes. */
  | 'locked'
  /** Desktop: registering is paused (the main computer cannot reach the other computers). */
  | 'paused'
  /** Desktop: this computer is no longer the main computer (a backup was promoted). */
  | 'not-main'
  /** The backend does not offer this feature. */
  | 'unsupported'
  | 'unknown';

/**
 * Error that is safe and readable to show to operators. `message` is always English (logs, tests);
 * `msg`, when present, is the same message in translatable form for the UI (see `errorText`).
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly msg: Msg | undefined;

  constructor(code: AppErrorCode, userMessage: Text, options?: { cause?: unknown }) {
    super(enText(userMessage), options);
    this.name = 'AppError';
    this.code = code;
    this.msg = isMsg(userMessage) ? userMessage : undefined;
  }
}

/** What to show for an AppError: its translatable message, else its (English) text. */
export function errorText(e: AppError): Text {
  return e.msg ?? e.message;
}

/**
 * A Firebase SDK error, recognised by shape rather than `instanceof` so this module (used by the
 * UI) does not depend on the Firebase SDK. Other backends throw AppError directly.
 */
function isFirebaseError(e: unknown): e is { name: 'FirebaseError'; code: string } {
  return (
    e instanceof Error &&
    e.name === 'FirebaseError' &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

/** Maps any thrown value to an AppError with a human-readable message. Never leaks raw errors. */
export function toAppError(e: unknown, fallback: Text = msg('errors.generic')) {
  if (e instanceof AppError) return e;
  if (isFirebaseError(e)) {
    switch (e.code) {
      case 'permission-denied':
        return new AppError('permission-denied', msg('errors.permissionDenied'), { cause: e });
      case 'unavailable':
      case 'deadline-exceeded':
      case 'auth/network-request-failed':
        return new AppError('network', msg('errors.network'), { cause: e });
      case 'not-found':
        return new AppError('not-found', msg('errors.notFound'), { cause: e });
    }
  }
  logError('Unhandled service error', e);
  return new AppError('unknown', fallback, { cause: e });
}
