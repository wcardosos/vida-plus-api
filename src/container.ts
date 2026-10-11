import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { Database } from './db/client';
import { env } from './env';
import { createAuditModule } from './modules/audit/audit.module';
import { createAuthModule } from './modules/auth/auth.module';
import { createUnitsModule } from './modules/units/units.module';
import { createConsoleEmailSender, type EmailSender } from './shared/email-sender';

export type ContainerDeps = {
  db: Database;
  logger: FastifyBaseLogger;
  emailSender?: EmailSender;
};

export function createContainer(deps: ContainerDeps) {
  const { db, logger } = deps;
  const emailSender = deps.emailSender ?? createConsoleEmailSender(logger);

  const audit = createAuditModule({ db, logger });
  const auth = createAuthModule({
    db,
    logger,
    emailSender,
    config: { appUrl: env.APP_URL, resetTokenTtlMs: env.RESET_TOKEN_TTL },
  });
  const units = createUnitsModule({ db });

  return {
    services: { audit: audit.service, auth: auth.service, units: units.service },
    routes: [audit.routes, auth.routes, units.routes] satisfies FastifyPluginAsync[],
  };
}

export type Container = ReturnType<typeof createContainer>;
