import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import type { UnitsService } from './services/units.service';
import {
  createUnitBodySchema,
  listUnitsQuerySchema,
  toUnitResponse,
  unitDeactivationErrorSchema,
  unitPageResponseSchema,
  unitParamsSchema,
  unitResponseSchema,
  updateUnitBodySchema,
} from './units.schemas';

export function unitsRoutes(unitsService: UnitsService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      '/units',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['units'],
          summary: 'Register a unit of the network',
          security: [{ bearerAuth: [] }],
          body: createUnitBodySchema,
          response: {
            201: unitResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const unit = await unitsService.create(request.body);
        reply.code(201);
        return toUnitResponse(unit);
      },
    );

    app.get(
      '/units',
      {
        onRequest: authenticate,
        schema: {
          tags: ['units'],
          summary: 'List units ordered by name; only ADMIN sees inactive units',
          security: [{ bearerAuth: [] }],
          querystring: listUnitsQuerySchema,
          response: { 200: unitPageResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
        },
      },
      async (request) => {
        const { limit, offset, ...filters } = request.query;
        const { items, total } = await unitsService.list(request.user, filters, { limit, offset });
        return { items: items.map(toUnitResponse), total, limit, offset };
      },
    );

    app.get(
      '/units/:id',
      {
        onRequest: authenticate,
        schema: {
          tags: ['units'],
          summary: 'Get a unit; inactive units are only visible to ADMIN',
          security: [{ bearerAuth: [] }],
          params: unitParamsSchema,
          response: { 200: unitResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => toUnitResponse(await unitsService.getById(request.user, request.params.id)),
    );

    app.patch(
      '/units/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['units'],
          summary: 'Change the name or address of an active unit',
          security: [{ bearerAuth: [] }],
          params: unitParamsSchema,
          body: updateUnitBodySchema,
          response: {
            200: unitResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toUnitResponse(await unitsService.update(request.params.id, request.body)),
    );

    app.post(
      '/units/:id/deactivate',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['units'],
          summary: 'Deactivate a unit; fails while it has pendencies such as future appointments',
          security: [{ bearerAuth: [] }],
          params: unitParamsSchema,
          response: {
            204: z.undefined(),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: unitDeactivationErrorSchema,
          },
        },
      },
      async (request, reply) => {
        await unitsService.deactivate(request.params.id);
        reply.code(204).send();
      },
    );
  };
}
