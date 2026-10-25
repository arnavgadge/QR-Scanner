import { AppError } from '../services/errors';
import { desktopBridge } from './bridge';
import type { OpIn, OpName, OpOut } from './protocol';

/** Calls the main computer through the desktop bridge; failures become AppErrors. */
export async function desktopCall<K extends OpName>(op: K, input: OpIn<K>): Promise<OpOut<K>> {
  const r = await desktopBridge()!.call(op, input);
  if (r.ok) return r.data;
  throw new AppError(r.error.code, r.error.msg ?? r.error.message);
}
