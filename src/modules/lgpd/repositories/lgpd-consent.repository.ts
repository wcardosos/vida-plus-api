import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { LgpdConsent, type ConsentPurpose } from '../entities/lgpd-consent.entity';
import { lgpdConsents } from '../schema';

type LgpdConsentRow = typeof lgpdConsents.$inferSelect;

function toEntity(row: LgpdConsentRow): LgpdConsent {
  return LgpdConsent.restore({
    id: row.id,
    patientId: row.patientId,
    purpose: row.purpose,
    termsVersion: row.termsVersion,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
  });
}

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

    async update(consent: LgpdConsent, executor: DbExecutor = db): Promise<void> {
      await executor.update(lgpdConsents).set({ revokedAt: consent.revokedAt }).where(eq(lgpdConsents.id, consent.id));
    },

    async findByIdForUpdate(id: string, executor: Transaction): Promise<LgpdConsent | null> {
      const [row] = await executor.select().from(lgpdConsents).where(eq(lgpdConsents.id, id)).for('update');
      return row ? toEntity(row) : null;
    },

    async findByPatient(patientId: string, executor: DbExecutor = db): Promise<LgpdConsent[]> {
      const rows = await executor
        .select()
        .from(lgpdConsents)
        .where(eq(lgpdConsents.patientId, patientId))
        .orderBy(desc(lgpdConsents.grantedAt), desc(lgpdConsents.id));
      return rows.map(toEntity);
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
