import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client';
import { auditRoutes } from './audit.routes';
import { createAuditRepository } from './repositories/audit.repository';
import { createAuditService } from './services/audit.service';

export function createAuditModule(deps: { db: Database; logger: FastifyBaseLogger }) {
  const service = createAuditService({ repository: createAuditRepository(deps.db), logger: deps.logger });
  return { service, routes: auditRoutes(service) };
}
