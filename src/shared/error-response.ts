import { STATUS_CODES } from 'node:http';
import { z } from 'zod';

export const errorResponseSchema = z
  .object({
    message: z.string(),
    error: z.string(),
    statusCode: z.number().int(),
    details: z.array(z.object({ location: z.string().optional(), path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'ErrorResponse' });

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export function errorResponse(statusCode: number, message: string, details?: ErrorResponse['details']): ErrorResponse {
  return { message, error: STATUS_CODES[statusCode] ?? 'Error', statusCode, ...(details && { details }) };
}
