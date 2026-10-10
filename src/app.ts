import Fastify from 'fastify';
import { env } from './env.js';

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
