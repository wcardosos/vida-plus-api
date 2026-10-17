import type { Database, Transaction } from '../../../db/client';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { LgpdConsent, type ConsentPurpose } from '../entities/lgpd-consent.entity';
import type { LgpdConsentRepository } from '../repositories/lgpd-consent.repository';

export type LgpdServiceConfig = {
  termsVersion: string;
};

export type GrantConsentInput = {
  patientId: string;
  purpose: ConsentPurpose;
  termsVersion: string;
  at?: Date;
};

export type ConsentRevocation = {
  patientId: string;
  purpose: ConsentPurpose;
  at: Date;
};

export type ConsentRevocationEffect = {
  type: string;
  count: number;
  appointments?: { id: string; startsAt: string }[];
};

export type ConsentRevocationOutcome = {
  effect: ConsentRevocationEffect;
  afterCommit?: () => Promise<void>;
};

export type ConsentRevocationHandler = (revocation: ConsentRevocation, tx: Transaction) => Promise<ConsentRevocationOutcome | null>;

export type PatientResolver = (userId: string) => Promise<string>;

export type RevokedConsent = {
  consent: LgpdConsent;
  effects: ConsentRevocationEffect[];
};

export type LgpdService = ReturnType<typeof createLgpdService>;

export function createLgpdService(deps: { db: Database; consents: LgpdConsentRepository; clock: () => Date; config: LgpdServiceConfig }) {
  const { db, consents, clock, config } = deps;
  const revocationHandlers: ConsentRevocationHandler[] = [];
  let resolvePatientId: PatientResolver | undefined;

  function registerPatientResolver(resolver: PatientResolver): void {
    resolvePatientId = resolver;
  }

  function registerRevocationHandler(handler: ConsentRevocationHandler): void {
    revocationHandlers.push(handler);
  }

  async function currentPatientId(userId: string): Promise<string> {
    if (!resolvePatientId) {
      throw new Error('No patient resolver registered in the lgpd service');
    }
    return resolvePatientId(userId);
  }

  async function grantConsent(input: GrantConsentInput, tx?: Transaction): Promise<LgpdConsent> {
    const consent = LgpdConsent.grant(input.patientId, input.purpose, input.termsVersion, input.at ?? clock());
    await consents.insert(consent, tx);
    return consent;
  }

  async function hasActiveConsent(patientId: string, purpose: ConsentPurpose, tx?: Transaction): Promise<boolean> {
    return consents.existsActive(patientId, purpose, tx);
  }

  async function listOwnConsents(userId: string): Promise<LgpdConsent[]> {
    return consents.findByPatient(await currentPatientId(userId));
  }

  async function grantOwnConsent(userId: string, purpose: ConsentPurpose): Promise<LgpdConsent> {
    const patientId = await currentPatientId(userId);
    if (await consents.existsActive(patientId, purpose)) {
      throw new ConflictError('The patient already has an active consent for this purpose');
    }
    return grantConsent({ patientId, purpose, termsVersion: config.termsVersion });
  }

  async function revokeOwnConsent(userId: string, consentId: string): Promise<RevokedConsent> {
    const patientId = await currentPatientId(userId);
    const at = clock();

    const { consent, outcomes } = await db.transaction(async (tx) => {
      const consent = await consents.findByIdForUpdate(consentId, tx);
      if (!consent || consent.patientId !== patientId) {
        throw new NotFoundError('Consent not found');
      }
      consent.revoke(at);
      await consents.update(consent, tx);

      const outcomes: ConsentRevocationOutcome[] = [];
      for (const handler of revocationHandlers) {
        const outcome = await handler({ patientId, purpose: consent.purpose, at }, tx);
        if (outcome) {
          outcomes.push(outcome);
        }
      }
      return { consent, outcomes };
    });

    for (const outcome of outcomes) {
      await outcome.afterCommit?.();
    }
    return { consent, effects: outcomes.map((outcome) => outcome.effect) };
  }

  return {
    registerPatientResolver,
    registerRevocationHandler,
    grantConsent,
    hasActiveConsent,
    listOwnConsents,
    grantOwnConsent,
    revokeOwnConsent,
  };
}
