import { and, eq, isNull } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../db/client';
import type { ConsentPurpose, LgpdConsent } from '../entities/lgpd-consent.entity';
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

    async existsActive(patientId: string, purpose: ConsentPurpose, executor: DbExecutor = db): Promise<boolean> {
      const [row] = await executor
        .select({ id: lgpdConsents.id })
        .from(lgpdConsents)
        .where(and(eq(lgpdConsents.patientId, patientId), eq(lgpdConsents.purpose, purpose), isNull(lgpdConsents.revokedAt)))
        .limit(1);
      return row !== undefined;
    },
  };
}
