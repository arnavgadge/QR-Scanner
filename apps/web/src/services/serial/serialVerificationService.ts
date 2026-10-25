import { getFirebase } from '../firebase/client';
import { getCompany } from '../companies/companyService';
import { getUserProfile } from '../users/userService';
import { verifySerial, type VerificationResult, type VerifyInput } from './serialVerification';

/**
 * Production entry point used by the UI. The operator identity is derived here from Firebase
 * Auth and the stored profile; callers cannot supply or override `scannedBy`.
 */
export async function verifyAndRegisterSerial(input: VerifyInput): Promise<VerificationResult> {
  const { db, auth } = getFirebase();
  return verifySerial(
    {
      db,
      loadActor: async () => {
        const current = auth.currentUser;
        if (!current) return null;
        const profile = await getUserProfile(current.uid);
        return profile && profile.active ? { uid: profile.uid, name: profile.name } : null;
      },
      loadCompany: getCompany,
    },
    input,
  );
}
