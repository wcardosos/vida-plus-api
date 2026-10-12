import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import {
  createProfessionalBodySchema,
  linkUnitBodySchema,
  listProfessionalsQuerySchema,
  professionalPageResponseSchema,
  professionalParamsSchema,
  professionalPendencyErrorSchema,
  professionalResponseSchema,
  professionalUnitParamsSchema,
  toProfessionalResponse,
  toProfessionalSummaryResponse,
  updateProfessionalBodySchema,
} from './professionals.schemas';
import type { ProfessionalsService } from './services/professionals.service';

export function professionalsRoutes(professionalsService: ProfessionalsService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      '/professionals',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary: 'Register a professional linked to one or more active units; a link to set the password is emailed',
          security: [{ bearerAuth: [] }],
          body: createProfessionalBodySchema,
          response: {
            201: professionalResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const created = await professionalsService.create(request.body);
        reply.code(201);
        return toProfessionalResponse(created);
      },
    );

    app.get(
      '/professionals',
      {
        onRequest: authenticate,
        schema: {
          tags: ['professionals'],
          summary: 'List professionals by unit, category and specialty, ordered by name; account data is only shown to ADMIN',
          security: [{ bearerAuth: [] }],
          querystring: listProfessionalsQuerySchema,
          response: { 200: professionalPageResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
        },
      },
      async (request) => {
        const { page, pageSize, ...filters } = request.query;
        const { items, total } = await professionalsService.list(request.user, filters, { page, pageSize });
        const toResponse = request.user.role === 'ADMIN' ? toProfessionalResponse : toProfessionalSummaryResponse;
        return { items: items.map(toResponse), page, pageSize, total };
      },
    );

    app.get(
      '/professionals/me',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags: ['professionals'],
          summary: 'Get the authenticated professional and the units they are linked to',
          security: [{ bearerAuth: [] }],
          response: { 200: professionalResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => toProfessionalResponse(await professionalsService.getByUserId(request.user.id)),
    );

    app.get(
      '/professionals/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary: 'Get a professional',
          security: [{ bearerAuth: [] }],
          params: professionalParamsSchema,
          response: {
            200: professionalResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => toProfessionalResponse(await professionalsService.getById(request.params.id)),
    );

    app.patch(
      '/professionals/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary: 'Change the name, email, category, council registration or specialty of a professional',
          security: [{ bearerAuth: [] }],
          params: professionalParamsSchema,
          body: updateProfessionalBodySchema,
          response: {
            200: professionalResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toProfessionalResponse(await professionalsService.update(request.params.id, request.body)),
    );

    app.post(
      '/professionals/:id/units',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary: 'Link the professional to an active unit',
          security: [{ bearerAuth: [] }],
          params: professionalParamsSchema,
          body: linkUnitBodySchema,
          response: {
            204: z.undefined(),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        await professionalsService.linkUnit(request.params.id, request.body.unitId);
        reply.code(204).send();
      },
    );

    app.delete(
      '/professionals/:id/units/:unitId',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary:
            'Unlink the professional from a unit; the last unit cannot be unlinked, nor one with future appointments or active admissions under their responsibility. The availabilities in the unit are removed',
          security: [{ bearerAuth: [] }],
          params: professionalUnitParamsSchema,
          response: {
            204: z.undefined(),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: professionalPendencyErrorSchema,
          },
        },
      },
      async (request, reply) => {
        await professionalsService.unlinkUnit(request.params.id, request.params.unitId);
        reply.code(204).send();
      },
    );

    app.post(
      '/professionals/:id/deactivate',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary: 'Deactivate the professional account; fails while there are future appointments or active admissions under their responsibility. The record and unit links are kept',
          security: [{ bearerAuth: [] }],
          params: professionalParamsSchema,
          response: {
            204: z.undefined(),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: professionalPendencyErrorSchema,
          },
        },
      },
      async (request, reply) => {
        await professionalsService.deactivate(request.params.id);
        reply.code(204).send();
      },
    );

    app.post(
      '/professionals/:id/activate',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['professionals'],
          summary: 'Reactivate the professional account',
          security: [{ bearerAuth: [] }],
          params: professionalParamsSchema,
          response: {
            204: z.undefined(),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        await professionalsService.activate(request.params.id);
        reply.code(204).send();
      },
    );
  };
}
