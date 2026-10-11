import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import { auditLogPageResponseSchema, listAuditLogsQuerySchema, toAuditLogResponse } from './audit.schemas';
import type { AuditService } from './services/audit.service';

export function auditRoutes(auditService: AuditService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/audit-logs',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['audit'],
          summary: 'List the audit trail, most recent first',
          security: [{ bearerAuth: [] }],
          querystring: listAuditLogsQuerySchema,
          response: {
            200: auditLogPageResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const { userId, patientId, action, from, to, page, pageSize } = request.query;
        const { items, total } = await auditService.list(
          { userId, patientId, action, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined },
          { page, pageSize },
        );
        return { items: items.map(toAuditLogResponse), page, pageSize, total };
      },
    );
  };
}
