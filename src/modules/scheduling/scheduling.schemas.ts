import { z } from 'zod';
import { errorResponseSchema } from '../../shared/error-response';
import { Appointment, appointmentStatuses, cancellationActors, modalities } from './entities/appointment.entity';
import { ScheduleAvailability, type Slot } from './entities/schedule-availability.entity';
import { ScheduleBlock } from './entities/schedule-block.entity';
import type { AppointmentDetails } from './services/scheduling.service';

const dayMs = 86_400_000;

export const maxPeriodDays = 31;

export const modalitySchema = z.enum(modalities).meta({ id: 'Modality' });

export const appointmentStatusSchema = z.enum(appointmentStatuses).meta({ id: 'AppointmentStatus' });

const instantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const timeOfDaySchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'time must be formatted as HH:MM')
  .describe(`Local time (HH:MM) in the network time zone`);

const weekdaySchema = z.number().int().describe('ISO 8601 weekday: 1 = Monday to 7 = Sunday');

const slotMinutesSchema = z
  .number()
  .int()
  .describe(`Between ${ScheduleAvailability.slotMinutesMin} and ${ScheduleAvailability.slotMinutesMax}; must fit in the time range`);

const idParamsSchema = z.object({
  id: z.uuid(),
});

export const availabilityParamsSchema = idParamsSchema;

export const blockParamsSchema = idParamsSchema;

export const appointmentParamsSchema = idParamsSchema;

export const listAvailabilitiesQuerySchema = z.object({
  unitId: z.uuid().optional(),
});

export const createAvailabilityBodySchema = z
  .object({
    unitId: z.uuid().describe('Active unit the professional is linked to'),
    weekday: weekdaySchema,
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema.describe('After startTime; leftover minutes that do not fit a slot are discarded'),
    slotMinutes: slotMinutesSchema,
    modality: modalitySchema,
  })
  .describe('Must not overlap any other availability of the professional, in any unit or modality')
  .meta({
    example: {
      unitId: '0b6f4c1e-8d43-4f3a-9a52-3f1f5f0c2d11',
      weekday: 1,
      startTime: '08:00',
      endTime: '12:00',
      slotMinutes: 30,
      modality: 'IN_PERSON',
    },
  });

export const updateAvailabilityBodySchema = z
  .strictObject({
    unitId: z.uuid().optional(),
    weekday: weekdaySchema.optional(),
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
    slotMinutes: slotMinutesSchema.optional(),
    modality: modalitySchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'At least one field is required' })
  .describe('Changing an availability does not cancel the appointments already scheduled in it')
  .meta({ example: { endTime: '11:00', slotMinutes: 20 } });

const whenValid = { when: (payload: z.core.ParsePayload) => payload.issues.length === 0 };

function periodRefinement(maxDays?: number) {
  return (period: { from?: Date; to?: Date }, ctx: z.RefinementCtx) => {
    if (!period.from || !period.to) {
      return;
    }
    if (period.to <= period.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    } else if (maxDays !== undefined && period.to.getTime() - period.from.getTime() > maxDays * dayMs) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `The period must span at most ${maxDays} days` });
    }
  };
}

export const listBlocksQuerySchema = z
  .object({
    from: instantSchema.optional().describe('Only blocks that end after this instant'),
    to: instantSchema.optional().describe('Only blocks that start before this instant'),
  })
  .superRefine(periodRefinement(), whenValid);

export const createBlockBodySchema = z
  .object({
    startsAt: instantSchema,
    endsAt: instantSchema.describe('After startsAt'),
    reason: z.string().trim().min(1).max(ScheduleBlock.reasonMaxLength).describe(`Up to ${ScheduleBlock.reasonMaxLength} characters`),
  })
  .describe('Appointments in the period are kept SCHEDULED and returned so the professional can cancel them')
  .meta({ example: { startsAt: '2026-10-20T03:00:00Z', endsAt: '2026-10-25T03:00:00Z', reason: 'Férias' } });

export const dayQuerySchema = z.object({
  date: z.iso.date().describe('Calendar date (YYYY-MM-DD) in the network time zone'),
  unitId: z.uuid().optional(),
});

export const freeSlotsQuerySchema = z
  .object({
    professionalId: z.uuid(),
    from: instantSchema,
    to: instantSchema.describe(`At most ${maxPeriodDays} days after from`),
    modality: modalitySchema.optional(),
    unitId: z.uuid().optional(),
  })
  .superRefine(periodRefinement(maxPeriodDays), whenValid);

export const scheduleAppointmentBodySchema = z
  .object({
    professionalId: z.uuid(),
    unitId: z.uuid().describe('Unit of the availability that offers the slot, also for a teleconsultation'),
    modality: modalitySchema,
    startsAt: instantSchema.describe('Start of a free slot; the end comes from the slot'),
    acceptTeleconsultationTerms: z
      .boolean()
      .optional()
      .describe('For a teleconsultation without an active consent: true grants it together with the appointment'),
  })
  .meta({
    example: {
      professionalId: '8f0c2a6e-41b5-4d3c-9f1e-6a7b8c9d0e1f',
      unitId: '2a91c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      modality: 'TELECONSULTATION',
      startsAt: '2026-10-19T12:00:00Z',
      acceptTeleconsultationTerms: true,
    },
  });

export const listAppointmentsQuerySchema = z
  .object({
    status: appointmentStatusSchema.optional(),
    from: instantSchema.optional().describe('Only appointments that start at or after this instant'),
    to: instantSchema.optional().describe('Only appointments that start before this instant'),
    professionalId: z.uuid().optional().describe('Only honored for ADMIN; a professional always sees their own appointments'),
    patientId: z.uuid().optional().describe('Only honored for ADMIN; a patient always sees their own appointments'),
    unitId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .superRefine(periodRefinement(), whenValid);

export const cancelAppointmentBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(Appointment.cancellationReasonMaxLength)
    .describe(`Up to ${Appointment.cancellationReasonMaxLength} characters`),
});

export const availabilityResponseSchema = z
  .object({
    id: z.uuid(),
    professionalId: z.uuid(),
    unitId: z.uuid(),
    weekday: z.number().int(),
    startTime: z.string(),
    endTime: z.string(),
    slotMinutes: z.number().int(),
    modality: modalitySchema,
  })
  .meta({ id: 'Availability' });

export const blockResponseSchema = z
  .object({
    id: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    reason: z.string(),
  })
  .meta({ id: 'ScheduleBlock' });

export const createBlockResponseSchema = z.object({
  block: blockResponseSchema,
  affectedAppointments: z
    .array(z.object({ id: z.uuid(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), patientName: z.string() }))
    .describe('SCHEDULED appointments in the blocked period, in chronological order'),
});

export const slotResponseSchema = z
  .object({
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    unitId: z.uuid(),
    modality: modalitySchema,
  })
  .meta({ id: 'Slot' });

const referenceSchema = z.object({ id: z.uuid(), name: z.string() });

export const appointmentResponseSchema = z
  .object({
    id: z.uuid(),
    patient: referenceSchema,
    professional: referenceSchema,
    unit: referenceSchema,
    modality: modalitySchema,
    status: appointmentStatusSchema,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    cancellationReason: z.string().nullable(),
    canceledBy: z.enum(cancellationActors).nullable(),
    canceledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Appointment' });

export const appointmentPageResponseSchema = z.object({
  items: z.array(appointmentResponseSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const scheduleAppointmentErrorSchema = errorResponseSchema
  .extend({
    code: z.literal('CONSENT_REQUIRED').optional().describe('Teleconsultation requested without an active consent'),
  })
  .meta({ id: 'ScheduleAppointmentError' });

export function toAvailabilityResponse(availability: ScheduleAvailability): z.infer<typeof availabilityResponseSchema> {
  return {
    id: availability.id,
    professionalId: availability.professionalId,
    unitId: availability.unitId,
    weekday: availability.weekday,
    startTime: availability.startTime.toString(),
    endTime: availability.endTime.toString(),
    slotMinutes: availability.slotMinutes,
    modality: availability.modality,
  };
}

export function toBlockResponse(block: ScheduleBlock): z.infer<typeof blockResponseSchema> {
  return { id: block.id, startsAt: block.startsAt.toISOString(), endsAt: block.endsAt.toISOString(), reason: block.reason };
}

export function toSlotResponse(slot: Slot): z.infer<typeof slotResponseSchema> {
  return { startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), unitId: slot.unitId, modality: slot.modality };
}

export function toAppointmentResponse({ appointment, patient, professional, unit }: AppointmentDetails): z.infer<typeof appointmentResponseSchema> {
  return {
    id: appointment.id,
    patient,
    professional,
    unit,
    modality: appointment.modality,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    cancellationReason: appointment.cancellationReason,
    canceledBy: appointment.canceledBy,
    canceledAt: appointment.canceledAt?.toISOString() ?? null,
    createdAt: appointment.createdAt.toISOString(),
  };
}
