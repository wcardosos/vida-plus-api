import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgEnum, pgTable, smallint, time, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { patients } from '../patients/schema';
import { professionals, professionalUnits } from '../professionals/schema';
import { units } from '../units/schema';
import { appointmentStatuses, cancellationActors, modalities } from './entities/appointment.entity';

export const modalityEnum = pgEnum('modality', modalities);

export const appointmentStatusEnum = pgEnum('appointment_status', appointmentStatuses);

export const cancellationActorEnum = pgEnum('cancellation_actor', cancellationActors);

export const scheduleAvailabilities = pgTable(
  'schedule_availabilities',
  {
    id: uuid('id').primaryKey(),
    professionalId: uuid('professional_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    slotMinutes: smallint('slot_minutes').notNull(),
    modality: modalityEnum('modality').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'schedule_availabilities_professional_unit_fk',
      columns: [table.professionalId, table.unitId],
      foreignColumns: [professionalUnits.professionalId, professionalUnits.unitId],
    }).onDelete('cascade'),
    index('schedule_availabilities_professional_weekday_idx').on(table.professionalId, table.weekday),
    check('schedule_availabilities_weekday_check', sql`${table.weekday} BETWEEN 1 AND 7`),
    check('schedule_availabilities_time_range_check', sql`${table.endTime} > ${table.startTime}`),
    check('schedule_availabilities_slot_minutes_check', sql`${table.slotMinutes} BETWEEN 5 AND 240`),
  ],
);

export const scheduleBlocks = pgTable(
  'schedule_blocks',
  {
    id: uuid('id').primaryKey(),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => professionals.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: varchar('reason', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('schedule_blocks_professional_starts_at_idx').on(table.professionalId, table.startsAt),
    check('schedule_blocks_time_range_check', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => professionals.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    modality: modalityEnum('modality').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: appointmentStatusEnum('status').notNull(),
    cancellationReason: varchar('cancellation_reason', { length: 200 }),
    canceledBy: cancellationActorEnum('canceled_by'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('appointments_professional_starts_at_idx').on(table.professionalId, table.startsAt),
    index('appointments_patient_starts_at_idx').on(table.patientId, table.startsAt),
    index('appointments_unit_starts_at_idx').on(table.unitId, table.startsAt),
    index('appointments_professional_patient_idx').on(table.professionalId, table.patientId),
    check('appointments_time_range_check', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'appointments_cancellation_reason_check',
      sql`(${table.status} = 'CANCELED') = (${table.cancellationReason} IS NOT NULL)`,
    ),
  ],
);
