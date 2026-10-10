import { z } from 'zod';
import { auditActions, auditResourceTypes, type AuditLog } from './audit.entity';

export const auditActionSchema = z.enum(auditActions).meta({ id: 'AuditAction' });

export const auditResourceTypeSchema = z.enum(auditResourceTypes).meta({ id: 'AuditResourceType' });

export const listAuditLogsQuerySchema = z
  .object({
    userId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    action: auditActionSchema.optional(),
    from: z.iso.datetime({ offset: true }).optional().describe('Inclusive lower bound for occurredAt (ISO 8601)'),
    to: z.iso.datetime({ offset: true }).optional().describe('Inclusive upper bound for occurredAt (ISO 8601)'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((query) => !query.from || !query.to || new Date(query.from) <= new Date(query.to), {
    path: ['from'],
    message: 'from must not be after to',
  });

export const auditLogResponseSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    action: auditActionSchema,
    resourceType: auditResourceTypeSchema,
    resourceId: z.uuid(),
    patientId: z.uuid().nullable(),
    ip: z.string(),
    occurredAt: z.iso.datetime(),
  })
  .meta({ id: 'AuditLog' });

export const auditLogPageResponseSchema = z.object({
  items: z.array(auditLogResponseSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export function toAuditLogResponse(log: AuditLog): z.infer<typeof auditLogResponseSchema> {
  return {
    id: log.id,
    userId: log.userId,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    patientId: log.patientId,
    ip: log.ip,
    occurredAt: log.occurredAt.toISOString(),
  };
}
