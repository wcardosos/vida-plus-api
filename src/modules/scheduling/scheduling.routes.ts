import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import {
  appointmentPageResponseSchema,
  appointmentParamsSchema,
  appointmentResponseSchema,
  availabilityParamsSchema,
  availabilityResponseSchema,
  blockParamsSchema,
  blockResponseSchema,
  cancelAppointmentBodySchema,
  createAvailabilityBodySchema,
  createBlockBodySchema,
  createBlockResponseSchema,
  dayQuerySchema,
  freeSlotsQuerySchema,
  listAppointmentsQuerySchema,
  listAvailabilitiesQuerySchema,
  listBlocksQuerySchema,
  scheduleAppointmentBodySchema,
  scheduleAppointmentErrorSchema,
  slotResponseSchema,
  toAppointmentResponse,
  toAvailabilityResponse,
  toBlockResponse,
  toSlotResponse,
  updateAvailabilityBodySchema,
} from './scheduling.schemas';
import type { SchedulingService } from './services/scheduling.service';

const tags = ['scheduling'];
const security = [{ bearerAuth: [] }];

export function schedulingRoutes(schedulingService: SchedulingService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/schedule/availabilities',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'List the availabilities of the authenticated professional by weekday and start time',
          security,
          querystring: listAvailabilitiesQuerySchema,
          response: { 200: z.array(availabilityResponseSchema), 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => (await schedulingService.listAvailabilities(request.user.id, request.query)).map(toAvailabilityResponse),
    );

    app.post(
      '/schedule/availabilities',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Publish a weekly availability of the authenticated professional in a unit and modality',
          security,
          body: createAvailabilityBodySchema,
          response: {
            201: availabilityResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const availability = await schedulingService.createAvailability(request.user.id, request.body);
        reply.code(201);
        return toAvailabilityResponse(availability);
      },
    );

    app.patch(
      '/schedule/availabilities/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Change an availability of the authenticated professional; scheduled appointments are kept',
          security,
          params: availabilityParamsSchema,
          body: updateAvailabilityBodySchema,
          response: {
            200: availabilityResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toAvailabilityResponse(await schedulingService.updateAvailability(request.user.id, request.params.id, request.body)),
    );

    app.delete(
      '/schedule/availabilities/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Remove an availability of the authenticated professional; scheduled appointments are kept',
          security,
          params: availabilityParamsSchema,
          response: { 204: z.undefined(), 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request, reply) => {
        await schedulingService.deleteAvailability(request.user.id, request.params.id);
        reply.code(204).send();
      },
    );

    app.get(
      '/schedule/blocks',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'List the blocks of the authenticated professional that overlap the period',
          security,
          querystring: listBlocksQuerySchema,
          response: { 200: z.array(blockResponseSchema), 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => (await schedulingService.listBlocks(request.user.id, request.query)).map(toBlockResponse),
    );

    app.post(
      '/schedule/blocks',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Block a period of the authenticated professional and list the scheduled appointments it affects',
          security,
          body: createBlockBodySchema,
          response: {
            201: createBlockResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const { block, affected } = await schedulingService.createBlock(request.user.id, request.body);
        reply.code(201);
        return {
          block: toBlockResponse(block),
          affectedAppointments: affected.map(({ appointment, patient }) => ({
            id: appointment.id,
            startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString(),
            patientName: patient.name,
          })),
        };
      },
    );

    app.delete(
      '/schedule/blocks/:id',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Remove a block of the authenticated professional',
          security,
          params: blockParamsSchema,
          response: { 204: z.undefined(), 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request, reply) => {
        await schedulingService.deleteBlock(request.user.id, request.params.id);
        reply.code(204).send();
      },
    );

    app.get(
      '/schedule/day',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Agenda of the authenticated professional for a local date, in chronological order',
          security,
          querystring: dayQuerySchema,
          response: { 200: z.array(appointmentResponseSchema), 400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
        },
      },
      async (request) => (await schedulingService.day(request.user.id, request.query.date, request.query.unitId)).map(toAppointmentResponse),
    );

    app.get(
      '/schedule/free-slots',
      {
        onRequest: authenticate,
        schema: {
          tags,
          summary: 'Free slots of a professional in a period of up to 31 days; empty for an inactive professional',
          security,
          querystring: freeSlotsQuerySchema,
          response: { 200: z.array(slotResponseSchema), 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => (await schedulingService.listFreeSlots(request.query)).map(toSlotResponse),
    );

    app.post(
      '/appointments',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags,
          summary: 'Book a free slot for the authenticated patient, in person or by teleconsultation',
          security,
          body: scheduleAppointmentBodySchema,
          response: {
            201: appointmentResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: scheduleAppointmentErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const details = await schedulingService.schedule(request.user.id, request.body);
        reply.code(201);
        return toAppointmentResponse(details);
      },
    );

    app.get(
      '/appointments',
      {
        onRequest: authenticate,
        schema: {
          tags,
          summary: 'List appointments in chronological order; patients and professionals only see their own',
          security,
          querystring: listAppointmentsQuerySchema,
          response: { 200: appointmentPageResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => {
        const { page, pageSize, ...filters } = request.query;
        const { items, total } = await schedulingService.list(request.user, filters, { page, pageSize });
        return { items: items.map(toAppointmentResponse), page, pageSize, total };
      },
    );

    app.get(
      '/appointments/:id',
      {
        onRequest: authenticate,
        schema: {
          tags,
          summary: 'Get an appointment of which the user is the patient or the professional; ADMIN sees any',
          security,
          params: appointmentParamsSchema,
          response: { 200: appointmentResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => toAppointmentResponse(await schedulingService.getById(request.user, request.params.id)),
    );

    app.post(
      '/appointments/:id/cancel',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT', 'PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Cancel a scheduled appointment before it starts, as its patient or professional',
          security,
          params: appointmentParamsSchema,
          body: cancelAppointmentBodySchema,
          response: {
            200: appointmentResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toAppointmentResponse(await schedulingService.cancel(request.user, request.params.id, request.body.reason)),
    );

    app.post(
      '/appointments/:id/no-show',
      {
        onRequest: authenticate,
        preHandler: requireRole('PROFESSIONAL'),
        schema: {
          tags,
          summary: 'Mark that the patient missed a scheduled appointment that has already started',
          security,
          params: appointmentParamsSchema,
          response: {
            200: appointmentResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toAppointmentResponse(await schedulingService.markNoShow(request.user.id, request.params.id)),
    );
  };
}
