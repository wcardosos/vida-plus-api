import { z } from 'zod';
import { consentPurposes, type LgpdConsent } from './entities/lgpd-consent.entity';
import type { RevokedConsent } from './services/lgpd.service';

export const consentPurposeSchema = z.enum(consentPurposes).meta({ id: 'ConsentPurpose' });

export const grantConsentBodySchema = z.object({
  purpose: consentPurposeSchema,
});

export const consentParamsSchema = z.object({
  consentId: z.uuid(),
});

export const consentResponseSchema = z
  .object({
    id: z.uuid(),
    purpose: consentPurposeSchema,
    termsVersion: z.string().describe('Version of the terms the patient accepted'),
    grantedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    active: z.boolean(),
  })
  .meta({ id: 'LgpdConsent' });

export const revokedConsentResponseSchema = z
  .object({
    consent: consentResponseSchema,
    effects: z
      .array(
        z.object({
          type: z.string().describe('e.g. CANCELED_TELECONSULTATIONS'),
          count: z.number().int(),
          appointments: z
            .array(z.object({ id: z.uuid(), startsAt: z.iso.datetime() }))
            .optional()
            .describe('The appointments affected by the revocation'),
        }),
      )
      .describe('What the revocation changed elsewhere, by type and quantity'),
  })
  .meta({ id: 'RevokedLgpdConsent' });

export function toConsentResponse(consent: LgpdConsent): z.infer<typeof consentResponseSchema> {
  return {
    id: consent.id,
    purpose: consent.purpose,
    termsVersion: consent.termsVersion,
    grantedAt: consent.grantedAt.toISOString(),
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    active: consent.isActive(),
  };
}

export function toRevokedConsentResponse(revoked: RevokedConsent): z.infer<typeof revokedConsentResponseSchema> {
  return { consent: toConsentResponse(revoked.consent), effects: revoked.effects };
}
