import { z } from 'zod';
import { errorResponseSchema } from '../../shared/error-response';
import { brazilianStates } from '../../shared/value-objects/address';
import { emailSchema } from '../auth/auth.schemas';
import { unitTypeSchema } from '../units/units.schemas';
import { CouncilRegistration, councils, Professional, professionalCategories } from './entities/professional.entity';
import type { ProfessionalDetails } from './services/professionals.service';

export const professionalCategorySchema = z.enum(professionalCategories).meta({ id: 'ProfessionalCategory' });

export const councilSchema = z.enum(councils).meta({ id: 'Council' });

const professionalNameSchema = z.string().max(Professional.nameMaxLength).describe(`Up to ${Professional.nameMaxLength} characters`);

const specialtySchema = z.string().max(Professional.specialtyMaxLength).describe(`Up to ${Professional.specialtyMaxLength} characters`);

const registrationBodySchema = z
  .object({
    council: z.string().max(10).describe('CRM for PHYSICIAN; COREN for NURSE and TECHNICIAN'),
    number: z.string().max(CouncilRegistration.numberMaxLength),
    state: z.string().max(2).describe('Brazilian state abbreviation (UF) of the council, e.g. PB'),
  })
  .describe('Unique per council, number and state');

export const createProfessionalBodySchema = z
  .object({
    name: professionalNameSchema,
    email: emailSchema.describe('A link to set the password is sent to this address'),
    category: professionalCategorySchema,
    registration: registrationBodySchema,
    specialty: specialtySchema.nullish(),
    unitIds: z.array(z.uuid()).min(1).max(50).describe('Active units the professional works at; at least one'),
  })
  .meta({
    example: {
      name: 'Dra. Ana Lima',
      email: 'ana.lima@vidaplus.com',
      category: 'PHYSICIAN',
      registration: { council: 'CRM', number: '12345', state: 'PB' },
      specialty: 'Cardiologia',
      unitIds: ['0b6f4c1e-8d43-4f3a-9a52-3f1f5f0c2d11'],
    },
  });

export const updateProfessionalBodySchema = z
  .strictObject({
    name: professionalNameSchema.optional(),
    email: emailSchema.optional(),
    category: professionalCategorySchema.optional(),
    registration: registrationBodySchema.optional(),
    specialty: specialtySchema.nullable().optional().describe('null clears the specialty'),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'At least one of name, email, category, registration or specialty is required',
  })
  .describe('Changing the category revalidates the registration against the new category')
  .meta({ example: { specialty: 'Cardiologia Pediátrica' } });

export const linkUnitBodySchema = z.object({
  unitId: z.uuid().describe('Active unit not yet linked to the professional'),
});

export const professionalParamsSchema = z.object({
  id: z.uuid(),
});

export const professionalUnitParamsSchema = z.object({
  id: z.uuid(),
  unitId: z.uuid(),
});

export const listProfessionalsQuerySchema = z.object({
  unitId: z.uuid().optional().describe('Only professionals linked to this unit'),
  category: professionalCategorySchema.optional(),
  specialty: z.string().trim().min(1).max(Professional.specialtyMaxLength).optional().describe('Case-insensitive partial match'),
  includeInactive: z.stringbool().default(false).describe('Only honored for ADMIN; other roles always see active professionals only'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const councilRegistrationResponseSchema = z
  .object({
    council: councilSchema,
    number: z.string(),
    state: z.enum(brazilianStates),
  })
  .meta({ id: 'CouncilRegistration' });

export const professionalUnitResponseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: unitTypeSchema,
    active: z.boolean(),
  })
  .meta({ id: 'ProfessionalUnit' });

export const professionalSummaryResponseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    category: professionalCategorySchema,
    specialty: z.string().nullable(),
    registration: councilRegistrationResponseSchema,
    units: z.array(professionalUnitResponseSchema),
  })
  .meta({ id: 'ProfessionalSummary', description: 'Public view of a professional, without account data' });

export const professionalResponseSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    email: z.string(),
    active: z.boolean().describe('Whether the professional account can log in'),
    category: professionalCategorySchema,
    specialty: z.string().nullable(),
    registration: councilRegistrationResponseSchema,
    units: z.array(professionalUnitResponseSchema),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Professional' });

export const professionalPageResponseSchema = z.object({
  items: z
    .array(z.union([professionalResponseSchema, professionalSummaryResponseSchema]))
    .describe('Professional for ADMIN; ProfessionalSummary for other roles'),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export const professionalPendencyErrorSchema = errorResponseSchema
  .extend({
    pendencies: z
      .array(
        z.object({
          type: z.string().describe('e.g. FUTURE_APPOINTMENTS, ACTIVE_ADMISSIONS'),
          count: z.number().int(),
          appointments: z
            .array(z.object({ id: z.uuid(), startsAt: z.iso.datetime() }))
            .optional()
            .describe('The scheduled appointments behind a FUTURE_APPOINTMENTS pendency'),
        }),
      )
      .optional()
      .describe('What prevents the operation, by type and quantity'),
  })
  .meta({ id: 'ProfessionalPendencyError' });

export function toProfessionalSummaryResponse({ professional, units }: ProfessionalDetails): z.infer<typeof professionalSummaryResponseSchema> {
  return {
    id: professional.id,
    name: professional.name,
    category: professional.category,
    specialty: professional.specialty,
    registration: professional.registration.toProps(),
    units: units.map((unit) => ({ id: unit.id, name: unit.name, type: unit.type, active: unit.active })),
  };
}

export function toProfessionalResponse(details: ProfessionalDetails): z.infer<typeof professionalResponseSchema> {
  const { professional, account } = details;
  const { id, name, category, specialty, registration, units } = toProfessionalSummaryResponse(details);
  return {
    id,
    userId: professional.userId,
    name,
    email: account.email,
    active: account.active,
    category,
    specialty,
    registration,
    units,
    createdAt: professional.createdAt.toISOString(),
  };
}
