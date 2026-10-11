import type { Transaction } from '../../../db/client';
import { LgpdConsent, type ConsentPurpose } from '../entities/lgpd-consent.entity';
import type { LgpdConsentRepository } from '../repositories/lgpd-consent.repository';

export type GrantConsentInput = {
  patientId: string;
  purpose: ConsentPurpose;
  termsVersion: string;
  at?: Date;
};

export type LgpdService = ReturnType<typeof createLgpdService>;

export function createLgpdService(deps: { consents: LgpdConsentRepository }) {
  const { consents } = deps;

  async function grantConsent(input: GrantConsentInput, tx?: Transaction): Promise<LgpdConsent> {
    const consent = LgpdConsent.grant(input.patientId, input.purpose, input.termsVersion, input.at ?? new Date());
    await consents.insert(consent, tx);
    return consent;
  }

  return { grantConsent };
}
