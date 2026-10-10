import { index, inet, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditActions, auditResourceTypes } from './audit.entity';

export const auditActionEnum = pgEnum('audit_action', auditActions);

export const auditResourceTypeEnum = pgEnum('audit_resource_type', auditResourceTypes);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    action: auditActionEnum('action').notNull(),
    resourceType: auditResourceTypeEnum('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    patientId: uuid('patient_id'),
    ip: inet('ip').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('audit_logs_occurred_at_id_idx').on(table.occurredAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
    index('audit_logs_user_id_occurred_at_idx').on(table.userId, table.occurredAt.desc().nullsFirst()),
    index('audit_logs_patient_id_occurred_at_idx').on(table.patientId, table.occurredAt.desc().nullsFirst()),
  ],
);
