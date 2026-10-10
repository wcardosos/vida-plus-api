import { hostname } from 'node:os';
import { DrizzleQueryError } from 'drizzle-orm';
import type { FastifyRequest, FastifyServerOptions } from 'fastify';
import { pino } from 'pino';
import { env } from '../env';

const sensitiveKeys = ['password', 'passwordHash', 'newPassword', 'currentPassword', 'token', 'accessToken', 'refreshToken', 'cpf'];

export const loggerOptions = {
  level: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'vida-plus-api', env: env.NODE_ENV, pid: process.pid, hostname: hostname() },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      ...sensitiveKeys,
      ...sensitiveKeys.map((key) => `*.${key}`),
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (request: FastifyRequest) => ({
      method: request.method,
      url: request.url.split('?')[0],
      route: request.routeOptions.url,
      remoteAddress: request.ip,
    }),
  },
  ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
} satisfies FastifyServerOptions['logger'];

// Drizzle query params and pg error details can carry patient data, so only the root cause's identity is logged.
export function loggableError(error: unknown) {
  if (error instanceof DrizzleQueryError && error.cause) {
    const { name, message, stack } = error.cause;
    return { type: name, message, code: (error.cause as { code?: unknown }).code, stack };
  }
  return error;
}
