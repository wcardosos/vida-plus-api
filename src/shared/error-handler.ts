import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DrizzleQueryError } from 'drizzle-orm';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { errorResponse } from './error-response';
import { AppError } from './errors';
import { loggableError } from './logger';

const conflictMessages: Record<string, string> = {
  '23505': 'Resource already exists',
  '23P01': 'Resource conflicts with an existing one',
};

function conflictMessage(error: unknown): string | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? conflictMessages[code] : undefined;
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((issue) => ({
      location: error.validationContext,
      path: issue.instancePath,
      message: issue.message ?? 'Invalid value',
    }));
    return reply.code(400).send(errorResponse(400, 'Request validation failed', details));
  }

  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({ ...error.payload, ...errorResponse(error.statusCode, error.message) });
  }

  const conflict = conflictMessage(error);
  if (conflict) {
    return reply.code(409).send(errorResponse(409, conflict));
  }

  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.code(error.statusCode).send(errorResponse(error.statusCode, error.message));
  }

  request.log.error({ err: loggableError(error) }, 'unhandled error');
  return reply.code(500).send(errorResponse(500, 'Internal server error'));
}
