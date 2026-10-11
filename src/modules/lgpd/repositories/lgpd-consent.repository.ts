import type { Database, DbExecutor } from '../../../db/client';
import type { LgpdConsent } from '../entities/lgpd-consent.entity';
import { lgpdConsents } from '../schema';

export type LgpdConsentRepository = ReturnType<typeof createLgpdConsentRepository>;

export function createLgpdConsentRepository(db: Database) {
  return {
    async insert(consent: LgpdConsent, executor: DbExecutor = db): Promise<void> {
      await executor.insert(lgpdConsents).values({
        id: consent.id,
        patientId: consent.patientId,
        purpose: consent.purpose,
        termsVersion: consent.termsVersion,
        grantedAt: consent.grantedAt,
        revokedAt: consent.revokedAt,
      });
    },
  };
}
