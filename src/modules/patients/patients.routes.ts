import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import type { RequestContext } from '../../shared/request-context';
import {
  correctIdentityBodySchema,
  createPatientBodySchema,
  listPatientsQuerySchema,
  patientPageResponseSchema,
  patientParamsSchema,
  patientResponseSchema,
  registerPatientBodySchema,
  toPatientResponse,
  updatePatientBodySchema,
} from './patients.schemas';
import type { PatientsService } from './services/patients.service';

const registerRateLimit = { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW };

function requestContext(request: FastifyRequest): RequestContext {
  return { userId: request.user.id, ip: request.ip };
}

export function patientsRoutes(patientsService: PatientsService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      '/patients/register',
      {
        config: { rateLimit: registerRateLimit },
        schema: {
          tags: ['patients'],
          summary: 'Create a patient account; accepting the terms of use is required, the teleconsultation consent is optional',
          body: registerPatientBodySchema,
          response: {
            201: patientResponseSchema,
            400: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
            429: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const created = await patientsService.register(request.body);
        reply.code(201);
        return toPatientResponse(created);
      },
    );

    app.get(
      '/patients/me',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags: ['patients'],
          summary: 'Get the authenticated patient',
          security: [{ bearerAuth: [] }],
          response: { 200: patientResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => toPatientResponse(await patientsService.getByUserId(request.user.id)),
    );

    app.patch(
      '/patients/me',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags: ['patients'],
          summary: 'Change the name, phone, address or email of the authenticated patient',
          security: [{ bearerAuth: [] }],
          body: updatePatientBodySchema,
          response: {
            200: patientResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toPatientResponse(await patientsService.updateByUserId(request.user.id, request.body)),
    );

    app.get(
      '/patients',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Search patients by name or CPF, ordered by name',
          security: [{ bearerAuth: [] }],
          querystring: listPatientsQuerySchema,
          response: { 200: patientPageResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => {
        const { page, pageSize, ...filters } = request.query;
        const { items, total } = await patientsService.list(filters, { page, pageSize });
        return { items: items.map(toPatientResponse), page, pageSize, total };
      },
    );

    app.get(
      '/patients/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Get a patient',
          security: [{ bearerAuth: [] }],
          params: patientParamsSchema,
          response: {
            200: patientResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => toPatientResponse(await patientsService.getById(request.params.id)),
    );

    app.post(
      '/patients',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Register a patient; a link to set the password is emailed to the patient',
          security: [{ bearerAuth: [] }],
          body: createPatientBodySchema,
          response: {
            201: patientResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const created = await patientsService.createByAdmin(request.body);
        reply.code(201);
        return toPatientResponse(created);
      },
    );

    app.patch(
      '/patients/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Change the name, phone, address or email of a patient',
          security: [{ bearerAuth: [] }],
          params: patientParamsSchema,
          body: updatePatientBodySchema,
          response: {
            200: patientResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toPatientResponse(await patientsService.update(request.params.id, request.body)),
    );

    app.patch(
      '/patients/:id/identity',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Correct the CPF or birth date of a patient; the correction is recorded in the audit trail',
          security: [{ bearerAuth: [] }],
          params: patientParamsSchema,
          body: correctIdentityBodySchema,
          response: {
            200: patientResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toPatientResponse(await patientsService.correctIdentity(requestContext(request), request.params.id, request.body)),
    );

    app.post(
      '/patients/:id/deactivate',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Deactivate the patient account; the record is kept and login is refused',
          security: [{ bearerAuth: [] }],
          params: patientParamsSchema,
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
        await patientsService.deactivate(requestContext(request), request.params.id);
        reply.code(204).send();
      },
    );

    app.post(
      '/patients/:id/activate',
      {
        onRequest: authenticate,
        preHandler: requireRole('ADMIN'),
        schema: {
          tags: ['patients'],
          summary: 'Reactivate the patient account',
          security: [{ bearerAuth: [] }],
          params: patientParamsSchema,
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
        await patientsService.activate(requestContext(request), request.params.id);
        reply.code(204).send();
      },
    );
  };
}
