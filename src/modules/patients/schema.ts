import { sql } from 'drizzle-orm';
import { char, date, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';

export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 150 }).notNull(),
    cpf: char('cpf', { length: 11 }).notNull(),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    addressStreet: varchar('address_street', { length: 150 }).notNull(),
    addressNumber: varchar('address_number', { length: 20 }).notNull(),
    addressComplement: varchar('address_complement', { length: 100 }),
    addressDistrict: varchar('address_district', { length: 100 }).notNull(),
    addressCity: varchar('address_city', { length: 100 }).notNull(),
    addressState: char('address_state', { length: 2 }).notNull(),
    addressZipCode: char('address_zip_code', { length: 8 }).notNull(),
    termsVersion: varchar('terms_version', { length: 20 }).notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('patients_user_id_unique_idx').on(table.userId),
    uniqueIndex('patients_cpf_unique_idx').on(table.cpf),
    index('patients_name_lower_idx').on(sql`lower(${table.name})`),
  ],
);
