import type { FastifyBaseLogger } from 'fastify';
import type { Transaction } from '../../db/client';
import type { RequestContext } from '../../shared/request-context';
import { loggableError } from '../../shared/logger';
import { AuditLog, type AuditAction, type AuditResourceType } from './audit.entity';
import type { AuditLogFilters, AuditRepository, Pagination } from './audit.repository';

export type RecordAuditInput = {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  patientId?: string | null;
};

export type AuditService = ReturnType<typeof createAuditService>;

export function createAuditService(deps: { repository: AuditRepository; logger: FastifyBaseLogger }) {
  const { repository, logger } = deps;

  async function record(ctx: RequestContext, input: RecordAuditInput, tx?: Transaction): Promise<void> {
    const log = AuditLog.record({ ...input, userId: ctx.userId, ip: ctx.ip }, new Date());
    await repository.insert(log, tx);
  }

  async function recordAccessDenied(ctx: RequestContext, patientId: string): Promise<void> {
    try {
      await record(ctx, { action: 'ACCESS_DENIED', resourceType: 'PATIENT', resourceId: patientId, patientId });
    } catch (error) {
      logger.error({ err: loggableError(error), userId: ctx.userId, patientId }, 'failed to record access denied audit log');
    }
  }

  async function list(filters: AuditLogFilters, pagination: Pagination) {
    return repository.findMany(filters, pagination);
  }

  return { record, recordAccessDenied, list };
}
