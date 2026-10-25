/**
 * Password hashing and token handling, all with Node's built-in crypto (no custom cryptography).
 *  - Operator passwords: scrypt (memory-hard KDF), random 16-byte salt, constant-time compare.
 *  - Station credentials and sessions: 256-bit random tokens; the server stores only SHA-256
 *    hashes, so a copied database file cannot be used to impersonate a station or a person.
 */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** "scrypt$N$r$p$salt$hash" (base64), so parameters can be raised later without breaking logins. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      Buffer.from(saltB64, 'base64'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
      (err, k) => (err ? reject(err) : resolve(k)),
    ),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Minimum password rule for operator accounts. */
export const MIN_PASSWORD_LENGTH = 8;

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newId = () => randomUUID();

/**
 * Admin password recovery code: 20 characters from an unambiguous alphabet (100 bits), shown in
 * groups of 4. Stored only as a scrypt hash (like a password), and replicated to the backup.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCode(): string {
  const bytes = randomBytes(20);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g)!.join('-');
}
/** What the person typed, in the stored form (case, spaces and dashes do not matter). */
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
