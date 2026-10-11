import { boolean, char, index, pgEnum, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { unitTypes } from './entities/unit.entity';

export const unitTypeEnum = pgEnum('unit_type', unitTypes);

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    type: unitTypeEnum('type').notNull(),
    cnpj: char('cnpj', { length: 14 }).notNull(),
    addressStreet: varchar('address_street', { length: 150 }).notNull(),
    addressNumber: varchar('address_number', { length: 20 }).notNull(),
    addressComplement: varchar('address_complement', { length: 100 }),
    addressDistrict: varchar('address_district', { length: 100 }).notNull(),
    addressCity: varchar('address_city', { length: 100 }).notNull(),
    addressState: char('address_state', { length: 2 }).notNull(),
    addressZipCode: char('address_zip_code', { length: 8 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('units_cnpj_unique_idx').on(table.cnpj), index('units_type_active_idx').on(table.type, table.active)],
);
