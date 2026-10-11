import fastifyRateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { TooManyRequestsError } from '../shared/errors';

export const rateLimitPlugin = fp(
  async (app) => {
    await app.register(fastifyRateLimit, {
      global: false,
      errorResponseBuilder: (_request, context) =>
        new TooManyRequestsError(`Too many requests, retry in ${Math.max(1, Math.ceil(context.ttl / 1000))} seconds`),
    });
  },
  { name: 'rate-limit' },
);
