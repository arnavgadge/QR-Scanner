/**
 * HTTPS to the server. After pairing, TLS is pinned: the server must present exactly the
 * certificate received (code-protected) during pairing, compared by SHA-256 fingerprint, whatever
 * its IP address. Before pairing (the pairing exchange itself) the certificate cannot be known yet;
 * the pairing protocol then verifies it (see pairingClient.ts).
 */
import { X509Certificate } from 'node:crypto';
import { request, Agent } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { describeError } from '../log';
import { CERT_HOSTNAME } from '../server/certificate';

export const REQUEST_TIMEOUT_MS = 8_000;

export interface Endpoint {
  host: string;
  port: number;
}

export interface TlsPin {
  certPem: string;
  fingerprint: string;
}

export function pinFor(certPem: string): TlsPin {
  return { certPem, fingerprint: new X509Certificate(certPem).fingerprint256 };
}

/** TLS options that accept ONLY the pinned server certificate. */
export function pinnedTls(pin: TlsPin) {
  return {
    ca: pin.certPem,
    servername: CERT_HOSTNAME,
    checkServerIdentity: (_host: string, cert: { fingerprint256?: string }) =>
      cert.fingerprint256 === pin.fingerprint
        ? undefined
        : new Error('Server certificate does not match the paired server'),
    minVersion: 'TLSv1.2' as const,
  };
}

/**
 * TLS options that accept ONLY these certificates (the main computer and its backup), whichever
 * answers. Each is its own trust anchor; the fingerprint must match one of them exactly.
 */
export function pinnedTlsAny(certPems: string[]) {
  const pins = certPems.map(pinFor);
  const allowed = new Set(pins.map((p) => p.fingerprint));
  return {
    ca: pins.map((p) => p.certPem),
    servername: CERT_HOSTNAME,
    checkServerIdentity: (_host: string, cert: { fingerprint256?: string }) =>
      cert.fingerprint256 && allowed.has(cert.fingerprint256)
        ? undefined
        : new Error('Server certificate does not match the paired system'),
    minVersion: 'TLSv1.2' as const,
  };
}

/** The request never got an answer; `message` says why (TLS / connection error code included). */
export class NetworkError extends Error {}

const networkError = (e: Error) =>
  e instanceof NetworkError ? e : new NetworkError(describeError(e), { cause: e });

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

export interface JsonResponse {
  status: number;
  body: unknown;
  /** The server's certificate as PEM (used during pairing). */
  peerCertPem: string | null;
}

/** POST JSON. `tls` = pinned options, or null for the (pre-pairing) unauthenticated exchange. */
export function postJson(
  endpoint: Endpoint,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  tls: ReturnType<typeof pinnedTls> | ReturnType<typeof pinnedTlsAny> | null,
  agent?: Agent,
): Promise<JsonResponse> {
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: endpoint.host,
        port: endpoint.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          ...headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
        ...(agent ? { agent } : {}),
        ...(tls ?? { rejectUnauthorized: false, servername: CERT_HOSTNAME }),
      },
      (res) => {
        // Read the certificate now: the socket is released (keep-alive) once the body has ended.
        const raw = (res.socket as TLSSocket | null)?.getPeerCertificate?.()?.raw;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const peerCertPem = raw
            ? `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').replace(/.{64}/g, '$&\n')}\n-----END CERTIFICATE-----\n`
            : null;
          resolve({
            status: res.statusCode ?? 0,
            body: parseJson(Buffer.concat(chunks)),
            peerCertPem,
          });
        });
        res.on('error', (e) => reject(networkError(e)));
      },
    );
    req.on('timeout', () =>
      req.destroy(new NetworkError(`no answer within ${REQUEST_TIMEOUT_MS / 1000} s (timeout)`)),
    );
    req.on('error', (e) => reject(networkError(e)));
    req.end(payload);
  });
}
