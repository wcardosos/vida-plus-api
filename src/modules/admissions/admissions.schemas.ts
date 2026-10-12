import { z } from 'zod';
import { movementTypes } from './entities/admission-movement.entity';
import { admissionStatuses } from './entities/admission.entity';
import { Bed, bedStatuses, bedTypes, manualBedStatuses } from './entities/bed.entity';
import type { OccupancyMap } from './repositories/bed.repository';
import type { AdmissionDetails, BedSummary } from './services/admissions.service';

export const bedTypeSchema = z.enum(bedTypes).meta({ id: 'BedType' });

export const bedStatusSchema = z.enum(bedStatuses).meta({ id: 'BedStatus' });

export const admissionStatusSchema = z.enum(admissionStatuses).meta({ id: 'AdmissionStatus' });

const referenceSchema = z.object({ id: z.uuid(), name: z.string() });

const identificationSchema = z.string().max(Bed.identificationMaxLength).describe(`Unique in the unit, up to ${Bed.identificationMaxLength} characters`);

const sectorSchema = z.string().max(Bed.sectorMaxLength).describe(`Up to ${Bed.sectorMaxLength} characters`);

export const unitBedsParamsSchema = z.object({
  unitId: z.uuid(),
});

export const bedParamsSchema = z.object({
  bedId: z.uuid(),
});

export const admissionParamsSchema = z.object({
  admissionId: z.uuid(),
});

export const createBedBodySchema = z
  .object({
    identification: identificationSchema,
    sector: sectorSchema,
    type: bedTypeSchema,
  })
  .describe('Only HOSPITAL units have beds; a new bed starts AVAILABLE')
  .meta({ example: { identification: 'UTI-03', sector: 'UTI adulto', type: 'ICU' } });

export const updateBedBodySchema = z
  .strictObject({
    identification: identificationSchema.optional(),
    sector: sectorSchema.optional(),
    type: bedTypeSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), { message: 'At least one field is required' })
  .describe('Rejected while the bed is OCCUPIED')
  .meta({ example: { sector: 'Clínica médica, 2º andar' } });

export const changeBedStatusBodySchema = z
  .object({
    status: z.enum(manualBedStatuses).describe('OCCUPIED and CLEANING only come from admission operations'),
  })
  .describe('Rejected while the bed is OCCUPIED')
  .meta({ example: { status: 'AVAILABLE' } });

export const listBedsQuerySchema = z.object({
  status: bedStatusSchema.optional().describe('Only lists beds in this status; the summary still counts every status'),
  type: bedTypeSchema.optional().describe('Filters both the beds and the summary'),
});

export const admitBodySchema = z
  .object({
    patientId: z.uuid().describe('Active patient without an active admission'),
    bedId: z.uuid().describe('AVAILABLE bed of an active hospital'),
    responsibleProfessionalId: z.uuid().describe('Active professional linked to the unit of the bed'),
  })
  .meta({
    example: {
      patientId: '3f6c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      bedId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
      responsibleProfessionalId: '8f0c2a6e-41b5-4d3c-9f1e-6a7b8c9d0e1f',
    },
  });

export const transferBodySchema = z
  .object({
    toBedId: z.uuid().describe('AVAILABLE bed of the same unit'),
  })
  .meta({ example: { toBedId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' } });

export const listAdmissionsQuerySchema = z.object({
  unitId: z.uuid().optional(),
  status: admissionStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const bedResponseSchema = z
  .object({
    id: z.uuid(),
    unitId: z.uuid(),
    identification: z.string(),
    sector: z.string(),
    type: bedTypeSchema,
    status: bedStatusSchema,
  })
  .meta({ id: 'Bed' });

export const occupancyMapResponseSchema = z
  .object({
    beds: z.array(bedResponseSchema).describe('Ordered by identification'),
    summary: z
      .object({
        AVAILABLE: z.number().int(),
        OCCUPIED: z.number().int(),
        CLEANING: z.number().int(),
        MAINTENANCE: z.number().int(),
      })
      .describe('Beds of the unit per status, ignoring the status filter'),
  })
  .meta({ id: 'OccupancyMap' });

const bedSummarySchema = z.object({
  id: z.uuid(),
  identification: z.string(),
  sector: z.string(),
  type: bedTypeSchema,
});

const movementBedSchema = z.object({ id: z.uuid(), identification: z.string() });

export const admissionSummaryResponseSchema = z
  .object({
    id: z.uuid(),
    patient: referenceSchema,
    responsibleProfessional: referenceSchema,
    unit: referenceSchema,
    currentBed: bedSummarySchema.describe('After the discharge, the last bed'),
    status: admissionStatusSchema,
    admittedAt: z.iso.datetime(),
    dischargedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'AdmissionSummary' });

export const admissionResponseSchema = admissionSummaryResponseSchema
  .extend({
    movements: z
      .array(
        z.object({
          id: z.uuid(),
          type: z.enum(movementTypes),
          fromBed: movementBedSchema.nullable().describe('Null on ADMISSION'),
          toBed: movementBedSchema.nullable().describe('Null on DISCHARGE'),
          occurredAt: z.iso.datetime(),
        }),
      )
      .describe('In chronological order'),
  })
  .meta({ id: 'Admission' });

export const admissionPageResponseSchema = z.object({
  items: z.array(admissionSummaryResponseSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export function toBedResponse(bed: Bed): z.infer<typeof bedResponseSchema> {
  return { id: bed.id, unitId: bed.unitId, identification: bed.identification, sector: bed.sector, type: bed.type, status: bed.status };
}

export function toOccupancyMapResponse(map: OccupancyMap): z.infer<typeof occupancyMapResponseSchema> {
  return { beds: map.beds.map(toBedResponse), summary: map.summary };
}

function toMovementBed(bed: BedSummary | null) {
  return bed && { id: bed.id, identification: bed.identification };
}

export function toAdmissionSummaryResponse(details: AdmissionDetails): z.infer<typeof admissionSummaryResponseSchema> {
  const { admission } = details;
  return {
    id: admission.id,
    patient: details.patient,
    responsibleProfessional: details.responsibleProfessional,
    unit: details.unit,
    currentBed: details.currentBed,
    status: admission.status,
    admittedAt: admission.admittedAt.toISOString(),
    dischargedAt: admission.dischargedAt?.toISOString() ?? null,
  };
}

export function toAdmissionResponse(details: AdmissionDetails): z.infer<typeof admissionResponseSchema> {
  return {
    ...toAdmissionSummaryResponse(details),
    movements: details.movements.map(({ movement, fromBed, toBed }) => ({
      id: movement.id,
      type: movement.type,
      fromBed: toMovementBed(fromBed),
      toBed: toMovementBed(toBed),
      occurredAt: movement.occurredAt.toISOString(),
    })),
  };
}
