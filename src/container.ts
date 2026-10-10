import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { Database } from './db/client';
import { createAuditModule } from './modules/audit/audit.module';

export function createContainer(deps: { db: Database; logger: FastifyBaseLogger }) {
  const audit = createAuditModule(deps);

  return {
    services: { audit: audit.service },
    routes: [audit.routes] satisfies FastifyPluginAsync[],
  };
}

export type Container = ReturnType<typeof createContainer>;
