/**
 * Console logging for unexpected conditions only (the business audit trail is the Firestore
 * scan_log; successful scans are deliberately NOT logged here).
 *  - Development: full details (error objects, stacks) for debugging.
 *  - Production: one short line per event (label + error name/code/message). No stack traces,
 *    no nested objects (which can contain request details), no document contents.
 */
const verbose: boolean = import.meta.env.DEV;

function brief(detail: unknown): string {
  if (detail instanceof Error) {
    const code = (detail as { code?: unknown }).code;
    return `${detail.name}${typeof code === 'string' ? ` [${code}]` : ''}: ${detail.message.slice(0, 160)}`;
  }
  if (typeof detail === 'string') return detail.slice(0, 160);
  return typeof detail;
}

export function logError(label: string, ...details: unknown[]): void {
  if (verbose) console.error(label, ...details);
  else console.error(label, ...details.map(brief));
}

export function logWarn(label: string, ...details: unknown[]): void {
  if (verbose) console.warn(label, ...details);
  else console.warn(label, ...details.map(brief));
}
