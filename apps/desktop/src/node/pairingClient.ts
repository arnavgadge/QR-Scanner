/**
 * Station side of pairing (see server/pairing.ts). The typed code is used only locally, as the
 * SRP-6a password: the station sends A and its proof M1, never the code. The server's proof M2
 * shows it knows the same code; only then is the credential decrypted. Finally the certificate
 * the server presented on this very connection must equal the certificate inside the code-protected
 * payload, so a machine in the middle cannot slip in its own certificate.
 */
import { createDecipheriv, X509Certificate } from 'node:crypto';
import { SRP, SrpClient } from 'fast-srp-hap';
import { msg } from '../../../web/src/i18n/core';
import { AppError } from '../../../web/src/services/errors';
import type {
  PairFinishRequest,
  PairFinishResponse,
  PairSecret,
  PairStartResponse,
  WireResult,
} from '../../../web/src/desktop/protocol';
import { pairingKey, SRP_IDENTITY, SRP_PARAMS } from '../server/pairing';
import { NetworkError, postJson, type Endpoint, type JsonResponse } from './https';

/** How the pairing messages travel (replaceable in tests to record every byte sent and received). */
export type PairTransport = (path: string, body: unknown) => Promise<JsonResponse>;

export const httpsPairTransport =
  (endpoint: Endpoint): PairTransport =>
  (path, body) =>
    postJson(endpoint, path, body, {}, null);

function unwrap<T>(r: JsonResponse): T {
  const result = r.body as WireResult<T> | null;
  if (!result) throw new AppError('server-unreachable', msg('server.unreachable'));
  if (!result.ok) throw new AppError(result.error.code, result.error.msg ?? result.error.message);
  return result.data;
}

export async function pairWithServer(opts: {
  transport: PairTransport;
  code: string;
  /** Optional: stations are named on the station setup screen after pairing. */
  nodeName?: string;
  appVersion: string;
}): Promise<PairSecret> {
  const code = opts.code.trim();
  if (!/^\d{6}$/.test(code)) throw new AppError('invalid-data', msg('pairing.codeFormat'));
  try {
    const startRes = await opts.transport('/pair/start', {});
    const start = unwrap<PairStartResponse>(startRes);
    const client = new SrpClient(
      SRP_PARAMS,
      Buffer.from(start.salt, 'hex'),
      SRP_IDENTITY,
      Buffer.from(code),
      await SRP.genKey(32),
    );
    const finishReq: PairFinishRequest = {
      sessionId: start.sessionId,
      ...(opts.nodeName ? { nodeName: opts.nodeName } : {}),
      appVersion: opts.appVersion,
      A: client.computeA().toString('hex'),
      M1: '',
    };
    client.setB(Buffer.from(start.B, 'hex'));
    finishReq.M1 = client.computeM1().toString('hex');
    const finishRes = await opts.transport('/pair/finish', finishReq);
    const finish = unwrap<PairFinishResponse>(finishRes);

    try {
      client.checkM2(Buffer.from(finish.M2, 'hex'));
    } catch {
      throw new AppError('invalid-credentials', msg('pairing.wrongCode'));
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      pairingKey(client.computeK(), start.sessionId),
      Buffer.from(finish.iv, 'hex'),
    );
    decipher.setAAD(Buffer.from(start.sessionId));
    decipher.setAuthTag(Buffer.from(finish.tag, 'hex'));
    const secret = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(finish.ciphertext, 'hex')),
        decipher.final(),
      ]).toString('utf8'),
    ) as PairSecret;

    // The certificate this connection really used must be the server's own.
    const seen = finishRes.peerCertPem;
    if (
      seen &&
      new X509Certificate(seen).fingerprint256 !==
        new X509Certificate(secret.certPem).fingerprint256
    ) {
      throw new AppError('permission-denied', msg('pairing.notTheServer'));
    }
    if (secret.serverId !== start.serverId) {
      throw new AppError('permission-denied', msg('pairing.notTheServer'));
    }
    return secret;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof NetworkError)
      throw new AppError('server-unreachable', msg('server.unreachable'));
    throw new AppError('unknown', msg('pairing.failed'));
  }
}
