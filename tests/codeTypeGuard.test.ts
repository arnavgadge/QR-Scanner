import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { verifySerial, type VerifyDeps } from '../src/services/serial/serialVerification';
import type { Company } from '../src/types';

/** A Firestore that fails the test if it is touched at all: the guard must act before any write. */
const poisoned = new Proxy(
  {},
  {
    get() {
      throw new Error('Firestore must not be touched');
    },
  },
) as unknown as Firestore;

const company = (codeType: Company['codeType']): Company => ({
  id: 'c1',
  name: 'Broken Co',
  codeType,
  serialFormat: '',
  active: true,
  createdAt: null,
  updatedAt: null,
});
const deps = (c: Company): VerifyDeps => ({
  db: poisoned,
  loadActor: async () => ({ uid: 'u1', name: 'Oli' }),
  loadCompany: async () => c,
});

describe('a company without a valid code type cannot register serials', () => {
  it.each([null, 'hologram' as never, '' as never])(
    'code_type %j: refused before any Firestore write, for manual AND photo',
    async (ct) => {
      for (const source of ['manual', 'scan'] as const) {
        const r = await verifySerial(deps(company(ct)), {
          serial: 'ABC123456',
          companyId: 'c1',
          source,
        });
        expect(r).toMatchObject({
          result: 'error',
          code: 'code-type-not-configured',
          message: 'Company code type is not configured. Contact an administrator.',
        });
      }
    },
  );
});
