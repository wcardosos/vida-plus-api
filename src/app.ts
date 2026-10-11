import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createContainer } from './container';
import { db } from './db/client';
import { env } from './env';
import { authPlugin } from './plugins/auth';
import { rateLimitPlugin } from './plugins/rate-limit';
import { swaggerPlugin } from './plugins/swagger';
import type { EmailSender } from './shared/email-sender';
import { errorHandler } from './shared/error-handler';
import { errorResponse } from './shared/error-response';
import { loggerOptions } from './shared/logger';

export type BuildAppOptions = {
  emailSender?: EmailSender;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    trustProxy: env.TRUST_PROXY,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    reply.code(404).send(errorResponse(404, `Route ${request.method}:${path} not found`));
  });

  const container = createContainer({ db, logger: app.log, emailSender: options.emailSender });

  app.register(swaggerPlugin);
  app.register(rateLimitPlugin);
  app.register(authPlugin, { loadAuthenticatedUser: container.services.auth.findAuthenticatedUser });

  app.register(async (instance) => {
    instance.withTypeProvider<ZodTypeProvider>().get(
      '/health',
      {
        logLevel: 'warn',
        schema: {
          tags: ['health'],
          summary: 'Health check',
          response: { 200: z.object({ status: z.literal('ok') }) },
        },
      },
      async () => ({ status: 'ok' as const }),
    );
  });

  for (const routes of container.routes) {
    app.register(routes);
  }

  return app;
}
