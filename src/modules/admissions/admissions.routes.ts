import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import type { RequestContext } from '../../shared/request-context';
import {
  admissionPageResponseSchema,
  admissionParamsSchema,
  admissionResponseSchema,
  admissionSummaryResponseSchema,
  admitBodySchema,
  bedParamsSchema,
  bedResponseSchema,
  changeBedStatusBodySchema,
  createBedBodySchema,
  listAdmissionsQuerySchema,
  listBedsQuerySchema,
  occupancyMapResponseSchema,
  toAdmissionResponse,
  toAdmissionSummaryResponse,
  toBedResponse,
  toOccupancyMapResponse,
  transferBodySchema,
  unitBedsParamsSchema,
  updateBedBodySchema,
} from './admissions.schemas';
import type { AdmissionsService, Viewer } from './services/admissions.service';

const tags = ['admissions'];
const security = [{ bearerAuth: [] }];

function requestContext(request: FastifyRequest): RequestContext {
  return { userId: request.user.id, ip: request.ip };
}

function viewer(request: FastifyRequest): Viewer {
  return { ...requestContext(request), role: request.user.role };
}

export function admissionsRoutes(admissionsService: AdmissionsService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      '/units/:unitId/beds',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Register a bed in a hospital unit',
          security,
          params: unitBedsParamsSchema,
          body: createBedBodySchema,
          response: {
            201: bedResponseSchema,
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
        const bed = await admissionsService.createBed(request.params.unitId, request.body);
        reply.code(201);
        return toBedResponse(bed);
      },
    );

    app.get(
      '/units/:unitId/beds',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Occupancy map of a unit: its beds and how many are in each status',
          security,
          params: unitBedsParamsSchema,
          querystring: listBedsQuerySchema,
          response: {
            200: occupancyMapResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => toOccupancyMapResponse(await admissionsService.listBeds(request.params.unitId, request.query)),
    );

    app.patch(
      '/beds/:bedId',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Change the identification, sector or type of a bed that is not OCCUPIED',
          security,
          params: bedParamsSchema,
          body: updateBedBodySchema,
          response: {
            200: bedResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toBedResponse(await admissionsService.updateBed(request.params.bedId, request.body)),
    );

    app.patch(
      '/beds/:bedId/status',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Mark a bed that is not OCCUPIED as AVAILABLE (e.g. cleaning finished) or MAINTENANCE',
          security,
          params: bedParamsSchema,
          body: changeBedStatusBodySchema,
          response: {
            200: bedResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toBedResponse(await admissionsService.changeBedStatus(request.params.bedId, request.body.status)),
    );

    app.post(
      '/admissions',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Admit a patient to an available bed under a responsible professional',
          security,
          body: admitBodySchema,
          response: {
            201: admissionResponseSchema,
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
        const details = await admissionsService.admit(requestContext(request), request.body);
        reply.code(201);
        return toAdmissionResponse(details);
      },
    );

    app.get(
      '/admissions',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'List admissions, newest first',
          security,
          querystring: listAdmissionsQuerySchema,
          response: { 200: admissionPageResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => {
        const { page, pageSize, ...filters } = request.query;
        const { items, total } = await admissionsService.list(filters, { page, pageSize });
        return { items: items.map(toAdmissionSummaryResponse), page, pageSize, total };
      },
    );

    app.get(
      '/admissions/:admissionId',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN', 'PROFESSIONAL', 'PATIENT'),
        schema: {
          tags,
          summary: 'Get an admission with its movements; professionals only see the ones they are responsible for, patients their own',
          security,
          params: admissionParamsSchema,
          response: {
            200: admissionResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => toAdmissionResponse(await admissionsService.getById(viewer(request), request.params.admissionId)),
    );

    app.post(
      '/admissions/:admissionId/transfer',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Move an active admission to another available bed of the same unit; the previous bed goes to CLEANING',
          security,
          params: admissionParamsSchema,
          body: transferBodySchema,
          response: {
            200: admissionResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toAdmissionResponse(await admissionsService.transfer(requestContext(request), request.params.admissionId, request.body.toBedId)),
    );

    app.post(
      '/admissions/:admissionId/discharge',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags,
          summary: 'Discharge an active admission; the bed goes to CLEANING',
          security,
          params: admissionParamsSchema,
          response: {
            200: admissionResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toAdmissionResponse(await admissionsService.discharge(requestContext(request), request.params.admissionId)),
    );

    app.get(
      '/me/admissions',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Active admissions the authenticated professional is responsible for, oldest first',
          security,
          response: { 200: z.array(admissionSummaryResponseSchema), 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => (await admissionsService.listOwn(request.user.id)).map(toAdmissionSummaryResponse),
    );
  };
}
