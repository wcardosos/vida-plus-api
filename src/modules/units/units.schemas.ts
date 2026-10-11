import { z } from 'zod';
import { errorResponseSchema } from '../../shared/error-response';
import { Address, brazilianStates } from '../../shared/value-objects/address';
import { Unit, unitTypes } from './entities/unit.entity';

export const unitTypeSchema = z.enum(unitTypes).meta({ id: 'UnitType' });

export const addressBodySchema = z.object({
  street: z.string().max(Address.maxLength.street),
  number: z.string().max(Address.maxLength.number).describe('Street number; free text such as "s/n" or "123-A"'),
  complement: z.string().max(Address.maxLength.complement).nullish(),
  district: z.string().max(Address.maxLength.district),
  city: z.string().max(Address.maxLength.city),
  state: z.string().max(2).describe('Brazilian state abbreviation (UF), e.g. SP'),
  zipCode: z.string().max(9).describe('CEP with 8 digits, with or without hyphen'),
});

const unitNameSchema = z.string().max(Unit.nameMaxLength).describe(`Between ${Unit.nameMinLength} and ${Unit.nameMaxLength} characters`);

export const createUnitBodySchema = z.object({
  name: unitNameSchema,
  type: unitTypeSchema,
  cnpj: z.string().max(18).describe('Numeric or alphanumeric CNPJ, with or without punctuation'),
  address: addressBodySchema,
});

export const updateUnitBodySchema = z
  .strictObject({
    name: unitNameSchema.optional(),
    address: addressBodySchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.address !== undefined, { message: 'At least one of name or address is required' })
  .describe('type and cnpj cannot be changed after registration');

export const unitParamsSchema = z.object({
  id: z.uuid(),
});

export const listUnitsQuerySchema = z.object({
  type: unitTypeSchema.optional(),
  name: z.string().trim().min(1).max(Unit.nameMaxLength).optional().describe('Case-insensitive partial match'),
  city: z.string().trim().min(1).max(Address.maxLength.city).optional().describe('Case-insensitive exact match'),
  state: z.string().toUpperCase().pipe(z.enum(brazilianStates)).optional(),
  active: z.stringbool().optional().describe('Only honored for ADMIN; other roles always see active units only'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const addressResponseSchema = z
  .object({
    street: z.string(),
    number: z.string(),
    complement: z.string().nullable(),
    district: z.string(),
    city: z.string(),
    state: z.enum(brazilianStates),
    zipCode: z.string(),
  })
  .meta({ id: 'Address' });

export const unitResponseSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: unitTypeSchema,
    cnpj: z.string().describe('Formatted as XX.XXX.XXX/XXXX-XX'),
    address: addressResponseSchema,
    active: z.boolean(),
  })
  .meta({ id: 'Unit' });

export const unitPageResponseSchema = z.object({
  items: z.array(unitResponseSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const unitDeactivationErrorSchema = errorResponseSchema
  .extend({
    pendencies: z
      .array(z.object({ type: z.string().describe('e.g. FUTURE_APPOINTMENTS'), count: z.number().int() }))
      .optional()
      .describe('What prevents the deactivation, by type and quantity'),
  })
  .meta({ id: 'UnitDeactivationError' });

export function toUnitResponse(unit: Unit): z.infer<typeof unitResponseSchema> {
  return {
    id: unit.id,
    name: unit.name,
    type: unit.type,
    cnpj: unit.cnpj.formatted(),
    address: unit.address.toProps(),
    active: unit.active,
  };
}
