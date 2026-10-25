/**
 * Main-process log lines to the terminal (and Electron's stdout/stderr when launched from a
 * shortcut): "2026-10-11T07:30:00.000Z WARN [link] …". Used for server startup and every
 * connection failure, so problems are never silent. Never logs passwords, codes or tokens.
 * VICIMUS_LOG=silent turns it off (the test suite does this).
 */
export type LogLevel = 'info' | 'warn' | 'error';
export type LogSink = (level: LogLevel, scope: string, message: string) => void;

const consoleSink: LogSink = (level, scope, message) => {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
  if (level === 'info') console.log(line);
  else console.error(line);
};

let sink: LogSink = process.env.VICIMUS_LOG === 'silent' ? () => undefined : consoleSink;

/** Replaces where log lines go (tests capture them). Returns the previous sink. */
export function setLogSink(next: LogSink): LogSink {
  const prev = sink;
  sink = next;
  return prev;
}

export function logger(scope: string) {
  return {
    info: (m: string) => sink('info', scope, m),
    warn: (m: string) => sink('warn', scope, m),
    error: (m: string) => sink('error', scope, m),
  };
}

/** A short, safe description of an error: its code (ECONNREFUSED, CERT_…) and message. */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as NodeJS.ErrnoException).code;
  const cause = (e as Error & { cause?: unknown }).cause;
  const inner =
    cause instanceof Error && cause.message !== e.message
      ? ` (cause: ${describeError(cause)})`
      : '';
  return `${code ? `${code}: ` : ''}${e.message}${inner}`;
}
