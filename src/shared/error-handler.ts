import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { DrizzleQueryError } from 'drizzle-orm';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { errorResponse } from './error-response';
import { AppError } from './errors';
import { loggableError } from './logger';

const uniqueViolationCode = '23505';

function isUniqueViolation(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return (cause as { code?: unknown } | undefined)?.code === uniqueViolationCode;
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

  if (isUniqueViolation(error)) {
    return reply.code(409).send(errorResponse(409, 'Resource already exists'));
  }

  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.code(error.statusCode).send(errorResponse(error.statusCode, error.message));
  }

  request.log.error({ err: loggableError(error) }, 'unhandled error');
  return reply.code(500).send(errorResponse(500, 'Internal server error'));
}
