import { FirebaseError } from 'firebase/app';

export type AppErrorCode =
  | 'config'
  | 'invalid-credentials'
  | 'permission-denied'
  | 'network'
  | 'not-found'
  | 'invalid-data'
  | 'unknown';

/** Error whose `message` is safe and readable to show to operators. */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, userMessage: string, options?: { cause?: unknown }) {
    super(userMessage, options);
    this.name = 'AppError';
    this.code = code;
  }
}

const NETWORK_MESSAGE = 'Unable to connect to the database. Please try again.';

/** Maps any thrown value to an AppError with a human-readable message. Never leaks raw errors. */
export function toAppError(e: unknown, fallback = 'Something went wrong. Please try again.') {
  if (e instanceof AppError) return e;
  if (e instanceof FirebaseError) {
    switch (e.code) {
      case 'permission-denied':
        return new AppError(
          'permission-denied',
          'You do not have permission to access this data.',
          {
            cause: e,
          },
        );
      case 'unavailable':
      case 'deadline-exceeded':
      case 'auth/network-request-failed':
        return new AppError('network', NETWORK_MESSAGE, { cause: e });
      case 'not-found':
        return new AppError('not-found', 'The requested data was not found.', { cause: e });
    }
  }
  console.error('Unhandled service error', e);
  return new AppError('unknown', fallback, { cause: e });
}
