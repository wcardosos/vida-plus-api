import { index, pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { patients } from '../patients/schema';
import { consentPurposes } from './entities/lgpd-consent.entity';

export const consentPurposeEnum = pgEnum('consent_purpose', consentPurposes);

export const lgpdConsents = pgTable(
  'lgpd_consents',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    purpose: consentPurposeEnum('purpose').notNull(),
    termsVersion: varchar('terms_version', { length: 20 }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('lgpd_consents_patient_id_idx').on(table.patientId)],
);
