import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import type { RequestContext } from '../../shared/request-context';
import {
  admissionRecordParamsSchema,
  appointmentRecordParamsSchema,
  correctEntryBodySchema,
  correctionConflictResponseSchema,
  createEntryBodySchema,
  createEntryResponseSchema,
  entryParamsSchema,
  historyQuerySchema,
  medicalHistoryResponseSchema,
  medicalRecordEntryResponseSchema,
  patientHistoryParamsSchema,
  prescriptionParamsSchema,
  prescriptionResponseSchema,
  toEntryResponse,
  toHistoryResponse,
  toPrescriptionResponse,
} from './medical-records.schemas';
import type { MedicalRecordsService, Reader } from './services/medical-records.service';

const tags = ['medical-records'];
const security = [{ bearerAuth: [] }];

function requestContext(request: FastifyRequest): RequestContext {
  return { userId: request.user.id, ip: request.ip };
}

function reader(request: FastifyRequest): Reader {
  return { ...requestContext(request), role: request.user.role };
}

export function medicalRecordsRoutes(medicalRecordsService: MedicalRecordsService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      '/appointments/:appointmentId/medical-records',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Record an own appointment in the patient medical record, optionally issuing prescriptions; completes an in-person appointment',
          security,
          params: appointmentRecordParamsSchema,
          body: createEntryBodySchema,
          response: {
            201: createEntryResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const created = await medicalRecordsService.createEntry(requestContext(request), request.params.appointmentId, request.body);
        reply.code(201);
        return { ...toEntryResponse(created), prescriptions: created.prescriptions.map(toPrescriptionResponse) };
      },
    );

    app.post(
      '/admissions/:admissionId/medical-records',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Record the care of an active admission the authenticated professional is responsible for, optionally issuing prescriptions',
          security,
          params: admissionRecordParamsSchema,
          body: createEntryBodySchema,
          response: {
            201: createEntryResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const created = await medicalRecordsService.createAdmissionEntry(requestContext(request), request.params.admissionId, request.body);
        reply.code(201);
        return { ...toEntryResponse(created), prescriptions: created.prescriptions.map(toPrescriptionResponse) };
      },
    );

    app.post(
      '/medical-records/:entryId/corrections',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Correct an own entry by creating a new version that points to it; only the current version accepts a correction',
          security,
          params: entryParamsSchema,
          body: correctEntryBodySchema,
          response: {
            201: medicalRecordEntryResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: correctionConflictResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const corrected = await medicalRecordsService.correctEntry(requestContext(request), request.params.entryId, request.body);
        reply.code(201);
        return toEntryResponse(corrected);
      },
    );

    app.get(
      '/medical-records/:entryId/versions',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL', 'PATIENT'),
        schema: {
          tags,
          summary: 'Every version of the correction chain of an entry, newest first',
          security,
          params: entryParamsSchema,
          response: {
            200: z.array(medicalRecordEntryResponseSchema),
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => (await medicalRecordsService.listVersions(reader(request), request.params.entryId)).map(toEntryResponse),
    );

    app.get(
      '/me/medical-history',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags,
          summary: 'Medical history of the authenticated patient across every unit',
          security,
          querystring: historyQuerySchema,
          response: { 200: medicalHistoryResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => toHistoryResponse(await medicalRecordsService.ownHistory(requestContext(request), request.query)),
    );

    app.get(
      '/patients/:patientId/medical-history',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Medical history of a patient the authenticated professional attends, across every unit',
          security,
          params: patientHistoryParamsSchema,
          querystring: historyQuerySchema,
          response: {
            200: medicalHistoryResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) =>
        toHistoryResponse(await medicalRecordsService.patientHistory(requestContext(request), request.params.patientId, request.query)),
    );

    app.get(
      '/prescriptions/:prescriptionId',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL', 'PATIENT'),
        schema: {
          tags,
          summary: 'Get a prescription of the authenticated patient or of a patient the professional attends',
          security,
          params: prescriptionParamsSchema,
          response: {
            200: prescriptionResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => toPrescriptionResponse(await medicalRecordsService.getPrescription(reader(request), request.params.prescriptionId)),
    );
  };
}
