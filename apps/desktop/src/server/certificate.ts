/**
 * The server's TLS identity: a self-signed certificate created once (on first start) and kept with
 * the database. Stations do not trust it by any authority: each station receives this exact
 * certificate during pairing (protected by the pairing code) and pins it, so the IP address may
 * change freely while a different machine can never pose as the server.
 *
 * The certificate is its own trust anchor, so it is marked CA:TRUE with keyCertSign. Electron's TLS
 * library (BoringSSL) refuses a pinned self-signed certificate without these ("unable to verify the
 * first certificate"), even though OpenSSL accepts it. A certificate from an earlier version that
 * lacks them is replaced on start (stations paired with the old one must pair again).
 */
import { randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';

/** DNS name in the certificate; stations send it as the TLS server name (SNI). */
export const CERT_HOSTNAME = 'vicimus-station';

export interface ServerIdentity {
  certPem: string;
  keyPem: string;
  /** SHA-256 fingerprint, e.g. "AB:CD:…". */
  fingerprint: string;
  /** How it was obtained on this start (for the startup log). */
  origin: 'loaded' | 'created' | 'replaced';
}

export function fingerprintOf(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}

/** True if the certificate can serve as its own trust anchor in every TLS library we run on. */
export function isUsableAnchor(certPem: string): boolean {
  try {
    const cert = new X509Certificate(certPem);
    return (
      cert.ca &&
      cert.checkIssued(cert) &&
      cert.verify(cert.publicKey) &&
      cert.checkHost(CERT_HOSTNAME) !== undefined
    );
  } catch {
    return false;
  }
}

async function createIdentity(serverId: string) {
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + 30);
  // Unique per computer: the main computer and its backup share the server ID, and TLS libraries
  // find a pinned certificate by its name, so two certificates must never have the same one.
  const computer = randomBytes(6).toString('hex');
  return generate(
    [{ name: 'commonName', value: `VICIMUS Serial Station ${serverId} ${computer}` }],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true },
        {
          name: 'keyUsage',
          keyCertSign: true,
          digitalSignature: true,
          keyEncipherment: true,
          critical: true,
        },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: [{ type: 2, value: CERT_HOSTNAME }] },
      ],
    },
  );
}

export async function loadOrCreateIdentity(dir: string, serverId: string): Promise<ServerIdentity> {
  const certFile = join(dir, 'server-cert.pem');
  const keyFile = join(dir, 'server-key.pem');
  const existed = existsSync(certFile) && existsSync(keyFile);
  if (existed) {
    const certPem = readFileSync(certFile, 'utf8');
    if (isUsableAnchor(certPem)) {
      return {
        certPem,
        keyPem: readFileSync(keyFile, 'utf8'),
        fingerprint: fingerprintOf(certPem),
        origin: 'loaded',
      };
    }
  }
  const pems = await createIdentity(serverId);
  writeFileSync(keyFile, pems.private, { mode: 0o600 });
  writeFileSync(certFile, pems.cert);
  return {
    certPem: pems.cert,
    keyPem: pems.private,
    fingerprint: fingerprintOf(pems.cert),
    origin: existed ? 'replaced' : 'created',
  };
}
