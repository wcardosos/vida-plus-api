import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from './env.js';
import { swaggerPlugin } from './plugins/swagger.js';

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(swaggerPlugin);

  app.register(async (instance) => {
    instance.withTypeProvider<ZodTypeProvider>().get(
      '/health',
      {
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
