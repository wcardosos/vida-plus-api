import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { patients } from '../patients/schema';
import { professionals } from '../professionals/schema';
import { appointments } from '../scheduling/schema';

export const medicalRecordEntries = pgTable(
  'medical_record_entries',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => professionals.id),
    appointmentId: uuid('appointment_id').references(() => appointments.id),
    admissionId: uuid('admission_id'),
    previousEntryId: uuid('previous_entry_id'),
    anamnesis: text('anamnesis').notNull(),
    icdCode: text('icd_code').notNull(),
    diagnosisNotes: text('diagnosis_notes'),
    conduct: text('conduct').notNull(),
    correctionReason: text('correction_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: 'medical_record_entries_previous_entry_id_fk',
      columns: [table.previousEntryId],
      foreignColumns: [table.id],
    }),
    uniqueIndex('medical_record_entries_previous_entry_id_unique_idx').on(table.previousEntryId),
    index('medical_record_entries_patient_created_at_idx').on(table.patientId, table.createdAt.desc().nullsFirst()),
    index('medical_record_entries_appointment_id_idx').on(table.appointmentId),
    check('medical_record_entries_single_origin_check', sql`num_nonnulls(${table.appointmentId}, ${table.admissionId}) = 1`),
    check('medical_record_entries_correction_reason_check', sql`(${table.previousEntryId} IS NULL) = (${table.correctionReason} IS NULL)`),
  ],
);

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: uuid('id').primaryKey(),
    medicalRecordEntryId: uuid('medical_record_entry_id')
      .notNull()
      .references(() => medicalRecordEntries.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    prescriberId: uuid('prescriber_id')
      .notNull()
      .references(() => professionals.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    verificationCode: varchar('verification_code', { length: 10 }).notNull(),
  },
  (table) => [
    uniqueIndex('prescriptions_verification_code_unique_idx').on(table.verificationCode),
    index('prescriptions_patient_issued_at_idx').on(table.patientId, table.issuedAt.desc().nullsFirst()),
    index('prescriptions_medical_record_entry_id_idx').on(table.medicalRecordEntryId),
  ],
);

export const prescriptionItems = pgTable(
  'prescription_items',
  {
    id: uuid('id').primaryKey(),
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'restrict' }),
    position: smallint('position').notNull(),
    medication: text('medication').notNull(),
    dose: text('dose').notNull(),
    dosageInstructions: text('dosage_instructions').notNull(),
    duration: text('duration').notNull(),
  },
  (table) => [
    uniqueIndex('prescription_items_prescription_position_unique_idx').on(table.prescriptionId, table.position),
    check('prescription_items_position_check', sql`${table.position} >= 1`),
  ],
);
