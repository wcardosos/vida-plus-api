import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { patients } from '../patients/schema';
import { professionals } from '../professionals/schema';
import { units } from '../units/schema';
import { movementTypes } from './entities/admission-movement.entity';
import { admissionStatuses } from './entities/admission.entity';
import { bedStatuses, bedTypes } from './entities/bed.entity';

export const bedTypeEnum = pgEnum('bed_type', bedTypes);

export const bedStatusEnum = pgEnum('bed_status', bedStatuses);

export const admissionStatusEnum = pgEnum('admission_status', admissionStatuses);

export const movementTypeEnum = pgEnum('movement_type', movementTypes);

export const beds = pgTable(
  'beds',
  {
    id: uuid('id').primaryKey(),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    identification: varchar('identification', { length: 20 }).notNull(),
    sector: varchar('sector', { length: 60 }).notNull(),
    type: bedTypeEnum('type').notNull(),
    status: bedStatusEnum('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('beds_unit_identification_unique_idx').on(table.unitId, table.identification),
    index('beds_unit_status_idx').on(table.unitId, table.status),
  ],
);

export const admissions = pgTable(
  'admissions',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    currentBedId: uuid('current_bed_id')
      .notNull()
      .references(() => beds.id),
    responsibleProfessionalId: uuid('responsible_professional_id')
      .notNull()
      .references(() => professionals.id),
    status: admissionStatusEnum('status').notNull(),
    admittedAt: timestamp('admitted_at', { withTimezone: true }).notNull(),
    dischargedAt: timestamp('discharged_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('admissions_active_bed_unique_idx').on(table.currentBedId).where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex('admissions_active_patient_unique_idx').on(table.patientId).where(sql`${table.status} = 'ACTIVE'`),
    index('admissions_responsible_status_idx').on(table.responsibleProfessionalId, table.status),
    index('admissions_patient_admitted_at_idx').on(table.patientId, table.admittedAt),
    index('admissions_unit_status_idx').on(table.unitId, table.status),
    check('admissions_discharged_at_check', sql`(${table.status} = 'DISCHARGED') = (${table.dischargedAt} IS NOT NULL)`),
  ],
);

export const admissionMovements = pgTable(
  'admission_movements',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id),
    type: movementTypeEnum('type').notNull(),
    fromBedId: uuid('from_bed_id').references(() => beds.id),
    toBedId: uuid('to_bed_id').references(() => beds.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('admission_movements_admission_occurred_at_idx').on(table.admissionId, table.occurredAt),
    check(
      'admission_movements_beds_check',
      sql`CASE ${table.type}
        WHEN 'ADMISSION' THEN ${table.fromBedId} IS NULL AND ${table.toBedId} IS NOT NULL
        WHEN 'DISCHARGE' THEN ${table.fromBedId} IS NOT NULL AND ${table.toBedId} IS NULL
        ELSE ${table.fromBedId} IS NOT NULL AND ${table.toBedId} IS NOT NULL AND ${table.fromBedId} <> ${table.toBedId}
      END`,
    ),
  ],
);
