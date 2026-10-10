import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from './env.js';
import { swaggerPlugin } from './plugins/swagger.js';
import { loggerOptions } from './shared/logger.js';

export function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    genReqId: () => randomUUID(),
    trustProxy: env.TRUST_PROXY,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    reply.code(404).send({ message: `Route ${request.method}:${path} not found`, error: 'Not Found', statusCode: 404 });
  });

  app.register(swaggerPlugin);

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

  return app;
}
