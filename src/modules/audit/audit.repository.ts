import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client';
import { AuditLog, type AuditAction } from './audit.entity';
import { auditLogs } from './schema';

export type AuditLogFilters = {
  userId?: string;
  patientId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
};

export type Pagination = {
  page: number;
  pageSize: number;
};

export type AuditRepository = ReturnType<typeof createAuditRepository>;

export function createAuditRepository(db: Database) {
  return {
    async insert(log: AuditLog, executor: DbExecutor = db): Promise<void> {
      await executor.insert(auditLogs).values({
        id: log.id,
        userId: log.userId,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        patientId: log.patientId,
        ip: log.ip,
        occurredAt: log.occurredAt,
      });
    },

    async findMany(filters: AuditLogFilters, { page, pageSize }: Pagination): Promise<{ items: AuditLog[]; total: number }> {
      const conditions: SQL[] = [];
      if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
      if (filters.patientId) conditions.push(eq(auditLogs.patientId, filters.patientId));
      if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
      if (filters.from) conditions.push(gte(auditLogs.occurredAt, filters.from));
      if (filters.to) conditions.push(lte(auditLogs.occurredAt, filters.to));
      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(auditLogs).where(where),
      ]);

      return { items: rows.map((row) => AuditLog.restore(row)), total };
    },
  };
}
