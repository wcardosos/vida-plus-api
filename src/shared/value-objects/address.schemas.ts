import { z } from 'zod';
import { Address, brazilianStates } from './address';

export const addressBodySchema = z.object({
  street: z.string().max(Address.maxLength.street),
  number: z.string().max(Address.maxLength.number).describe('Street number; free text such as "s/n" or "123-A"'),
  complement: z.string().max(Address.maxLength.complement).nullish(),
  district: z.string().max(Address.maxLength.district),
  city: z.string().max(Address.maxLength.city),
  state: z.string().max(2).describe('Brazilian state abbreviation (UF), e.g. SP'),
  zipCode: z.string().max(9).describe('CEP with 8 digits, with or without hyphen'),
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
