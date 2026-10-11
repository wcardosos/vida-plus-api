import { char, index, pgEnum, pgTable, primaryKey, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from '../auth/schema';
import { units } from '../units/schema';
import { councils, professionalCategories } from './entities/professional.entity';

export const professionalCategoryEnum = pgEnum('professional_category', professionalCategories);

export const councilEnum = pgEnum('council', councils);

export const professionals = pgTable(
  'professionals',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: varchar('name', { length: 150 }).notNull(),
    category: professionalCategoryEnum('category').notNull(),
    council: councilEnum('council').notNull(),
    registrationNumber: varchar('registration_number', { length: 20 }).notNull(),
    registrationState: char('registration_state', { length: 2 }).notNull(),
    specialty: varchar('specialty', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('professionals_user_id_unique_idx').on(table.userId),
    uniqueIndex('professionals_registration_unique_idx').on(table.council, table.registrationNumber, table.registrationState),
  ],
);

export const professionalUnits = pgTable(
  'professional_units',
  {
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => professionals.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.professionalId, table.unitId] }), index('professional_units_unit_id_idx').on(table.unitId)],
);
