import { z } from 'zod';
import { addressBodySchema, addressResponseSchema } from '../../shared/value-objects/address.schemas';
import { emailSchema, passwordSchema } from '../auth/auth.schemas';
import { Patient } from './entities/patient.entity';
import type { PatientWithAccount } from './repositories/patient.repository';

const exampleAddress = { street: 'Rua A', number: '10', district: 'Centro', city: 'Guarabira', state: 'PB', zipCode: '58200000' };

const patientNameSchema = z.string().max(Patient.nameMaxLength).describe(`Up to ${Patient.nameMaxLength} characters`);

const cpfSchema = z
  .string()
  .regex(/^\s*\d{3}\.?\d{3}\.?\d{3}-?\d{2}\s*$/, 'cpf must have 11 digits, with or without mask')
  .describe('CPF with or without mask, e.g. 529.982.247-25');

const birthDateSchema = z.iso.date().describe('Calendar date (YYYY-MM-DD), not in the future');

const phoneSchema = z.string().max(20).describe('Brazilian phone with area code (10 or 11 digits); mask allowed');

export const registerPatientBodySchema = z
  .object({
    name: patientNameSchema,
    cpf: cpfSchema,
    birthDate: birthDateSchema,
    phone: phoneSchema,
    address: addressBodySchema,
    email: emailSchema,
    password: passwordSchema,
    acceptTerms: z.boolean().describe('Must be true: the patient accepts the current version of the terms of use'),
    teleconsultationConsent: z.boolean().default(false).describe('Optional LGPD consent to be attended by teleconsultation'),
  })
  .meta({
    example: {
      name: 'Maria da Silva',
      cpf: '529.982.247-25',
      birthDate: '1990-04-12',
      phone: '83999990000',
      address: exampleAddress,
      email: 'maria@exemplo.com',
      password: 'a-strong-password',
      acceptTerms: true,
      teleconsultationConsent: false,
    },
  });

export const createPatientBodySchema = z
  .object({
    name: patientNameSchema,
    cpf: cpfSchema,
    birthDate: birthDateSchema,
    phone: phoneSchema,
    address: addressBodySchema,
    email: emailSchema.describe('A link to set the password is sent to this address'),
    acceptTerms: z.boolean().describe('Must be true: the patient accepted the current terms of use in person'),
  })
  .meta({
    example: {
      name: 'João Pereira',
      cpf: '111.444.777-35',
      birthDate: '1985-09-30',
      phone: '(83) 3271-0000',
      address: exampleAddress,
      email: 'joao@exemplo.com',
      acceptTerms: true,
    },
  });

export const updatePatientBodySchema = z
  .strictObject({
    name: patientNameSchema.optional(),
    phone: phoneSchema.optional(),
    address: addressBodySchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'At least one of name, phone, address or email is required',
  })
  .describe('cpf and birthDate can only be changed by an administrator through the identity correction')
  .meta({ example: { phone: '83988887777', email: 'maria.silva@exemplo.com' } });

export const correctIdentityBodySchema = z
  .strictObject({
    cpf: cpfSchema.optional(),
    birthDate: birthDateSchema.optional(),
  })
  .refine((body) => body.cpf !== undefined || body.birthDate !== undefined, { message: 'At least one of cpf or birthDate is required' })
  .meta({ example: { cpf: '111.444.777-35', birthDate: '1990-04-21' } });

export const patientParamsSchema = z.object({
  id: z.uuid(),
});

export const listPatientsQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .min(1)
    .max(Patient.nameMaxLength)
    .optional()
    .describe('Case-insensitive partial name, or the beginning of the CPF with or without mask'),
  active: z.stringbool().optional().describe('Filter by account status; omit to list both'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const patientResponseSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    cpf: z.string().describe('Formatted as XXX.XXX.XXX-XX'),
    birthDate: z.iso.date(),
    phone: z.string(),
    address: addressResponseSchema,
    email: z.string(),
    active: z.boolean().describe('Whether the patient account can log in'),
    termsVersion: z.string().describe('Version of the terms of use the patient accepted'),
    termsAcceptedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Patient' });

export const patientPageResponseSchema = z.object({
  items: z.array(patientResponseSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});

export function toPatientResponse({ patient, account }: PatientWithAccount): z.infer<typeof patientResponseSchema> {
  return {
    id: patient.id,
    userId: patient.userId,
    name: patient.name,
    cpf: patient.cpf.formatted(),
    birthDate: patient.birthDate,
    phone: patient.phone,
    address: patient.address.toProps(),
    email: account.email,
    active: account.active,
    termsVersion: patient.termsVersion,
    termsAcceptedAt: patient.termsAcceptedAt.toISOString(),
    createdAt: patient.createdAt.toISOString(),
  };
}
