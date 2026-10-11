import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client';
import type { EmailSender } from '../../shared/email-sender';
import { authRoutes } from './auth.routes';
import { createAuthService, type AuthServiceConfig } from './auth.service';
import { createPasswordResetTokenRepository } from './password-reset-token.repository';
import { createUserRepository } from './user.repository';

export function createAuthModule(deps: { db: Database; logger: FastifyBaseLogger; emailSender: EmailSender; config: AuthServiceConfig }) {
  const service = createAuthService({
    db: deps.db,
    users: createUserRepository(deps.db),
    resetTokens: createPasswordResetTokenRepository(deps.db),
    emailSender: deps.emailSender,
    logger: deps.logger,
    config: deps.config,
  });
  return { service, routes: authRoutes(service) };
}
