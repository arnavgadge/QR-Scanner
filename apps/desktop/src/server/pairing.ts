/**
 * Pairing a station with the server using the 6-digit code shown on the server screen.
 *
 * Standard primitives only:
 *  - SRP-6a (RFC 5054, 3072-bit group) via `fast-srp-hap` - the protocol Apple HomeKit uses to pair
 *    devices with a short setup code. The code is the SRP password: it is NEVER sent. The station
 *    sends only A and its proof M1; the server sends salt, B and its proof M2. An eavesdropper
 *    learns nothing that allows guessing the code offline; an active attacker gets one guess per
 *    attempt, and 5 wrong attempts lock pairing for 5 minutes.
 *  - The SRP session key K -> HKDF-SHA256 -> AES-256-GCM key, which encrypts the station's new
 *    credential and the server's TLS certificate (so the station can pin it).
 *
 * Code rules: a fresh random code every 30 s; single-use (a successful pairing replaces it at
 * once); pairing only while an administrator has "Add station" open on the server.
 */
import { createCipheriv, hkdfSync, randomBytes, randomInt } from 'node:crypto';
import { SRP, SrpServer } from 'fast-srp-hap';
import { msg } from '../../../web/src/i18n/core';
import { AppError } from '../../../web/src/services/errors';
import type {
  PairFinishRequest,
  PairFinishResponse,
  PairSecret,
  PairStartResponse,
  PairingStatus,
} from '../../../web/src/desktop/protocol';

export const CODE_LIFETIME_MS = 30_000;
export const MAX_WRONG_CODES = 5;
export const LOCKOUT_MS = 5 * 60_000;
/** "Add station" closes itself after this long. */
export const PAIRING_WINDOW_MS = 10 * 60_000;
/** A started pairing must finish within this time. */
const SESSION_MS = 60_000;

export const SRP_PARAMS = SRP.params[3072];
export const SRP_IDENTITY = Buffer.from('vicimus-station-pairing');
export const PAIR_KEY_INFO = Buffer.from('vicimus-station-pair-v1');

/** Derives the AES key that protects the pairing secret from the SRP session key. */
export function pairingKey(K: Buffer, sessionId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', K, Buffer.from(sessionId), PAIR_KEY_INFO, 32));
}

interface Session {
  srp: SrpServer;
  startedAt: number;
}

export interface PairingDeps {
  now: () => number;
  serverId: string;
  certPem: string;
  /** Creates the station record; returns its id and the (only) copy of its token. */
  createStation: (
    name: string,
    appVersion: string,
  ) => Promise<{ nodeId: string; nodeToken: string }>;
}

export class PairingManager {
  private code = '';
  private codeIssuedAt = 0;
  private openUntil = 0;
  private wrong = 0;
  private lockedUntil = 0;
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly deps: PairingDeps) {}

  /** Administrator opened "Add station" on the server screen. */
  open(): PairingStatus {
    this.openUntil = this.deps.now() + PAIRING_WINDOW_MS;
    this.newCode();
    return this.status();
  }

  close() {
    this.openUntil = 0;
    this.sessions.clear();
  }

  status(): PairingStatus {
    const now = this.deps.now();
    const open = now < this.openUntil;
    if (open) this.currentCode();
    return {
      open,
      code: open ? this.code : '',
      secondsLeft: open
        ? Math.max(0, Math.ceil((this.codeIssuedAt + CODE_LIFETIME_MS - now) / 1000))
        : 0,
      lockedUntil: this.lockedUntil > now ? new Date(this.lockedUntil).toISOString() : null,
    };
  }

  /** Step 1 (station -> server): returns salt and B. No code involved on the wire. */
  async start(): Promise<PairStartResponse> {
    this.assertAvailable();
    const now = this.deps.now();
    for (const [id, s] of this.sessions)
      if (now - s.startedAt > SESSION_MS) this.sessions.delete(id);
    if (this.sessions.size > 20) throw new AppError('locked', msg('pairing.busy'));
    const salt = randomBytes(16);
    const secret = await SRP.genKey(32);
    const srp = new SrpServer(
      SRP_PARAMS,
      salt,
      SRP_IDENTITY,
      Buffer.from(this.currentCode()),
      secret,
    );
    const sessionId = randomBytes(16).toString('hex');
    this.sessions.set(sessionId, { srp, startedAt: now });
    return {
      sessionId,
      serverId: this.deps.serverId,
      salt: salt.toString('hex'),
      B: srp.computeB().toString('hex'),
    };
  }

  /**
   * Step 2: checks the station's proof. Wrong code -> counts towards the lockout. Right code ->
   * the code is used up, the station is created, and its credential is returned encrypted.
   */
  async finish(req: PairFinishRequest): Promise<PairFinishResponse> {
    this.assertAvailable();
    const session = this.sessions.get(req.sessionId);
    this.sessions.delete(req.sessionId); // one proof per session
    if (!session || this.deps.now() - session.startedAt > SESSION_MS) {
      throw new AppError('invalid-data', msg('pairing.expired'));
    }
    try {
      session.srp.setA(Buffer.from(req.A, 'hex'));
      session.srp.checkM1(Buffer.from(req.M1, 'hex'));
    } catch {
      this.wrongCode();
      throw new AppError('invalid-credentials', msg('pairing.wrongCode'));
    }
    // The station is named on its setup screen right after pairing.
    const name = (req.nodeName ?? '').trim().slice(0, 60) || 'New station';

    // Correct code: it is used up immediately, whatever happens next.
    this.wrong = 0;
    this.newCode();
    const K = session.srp.computeK();
    const M2 = session.srp.computeM2();
    const created = await this.deps.createStation(name, req.appVersion);
    const secret: PairSecret = {
      nodeId: created.nodeId,
      nodeToken: created.nodeToken,
      serverId: this.deps.serverId,
      certPem: this.deps.certPem,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', pairingKey(K, req.sessionId), iv);
    cipher.setAAD(Buffer.from(req.sessionId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(secret), 'utf8'),
      cipher.final(),
    ]);
    return {
      M2: M2.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
    };
  }

  private assertAvailable() {
    const now = this.deps.now();
    if (this.lockedUntil > now) throw new AppError('locked', msg('pairing.locked'));
    if (now >= this.openUntil) throw new AppError('invalid-data', msg('pairing.closed'));
  }

  private wrongCode() {
    this.wrong += 1;
    if (this.wrong >= MAX_WRONG_CODES) {
      this.wrong = 0;
      this.lockedUntil = this.deps.now() + LOCKOUT_MS;
      this.sessions.clear();
      this.newCode();
    }
  }

  private currentCode(): string {
    if (this.deps.now() - this.codeIssuedAt >= CODE_LIFETIME_MS) this.newCode();
    return this.code;
  }

  private newCode() {
    let next = this.code;
    while (next === this.code) next = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.code = next;
    this.codeIssuedAt = this.deps.now();
  }
}
