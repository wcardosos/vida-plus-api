import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export const consentPurposes = ['TELECONSULTATION'] as const;

export type ConsentPurpose = (typeof consentPurposes)[number];

export type LgpdConsentProps = {
  id: string;
  patientId: string;
  purpose: ConsentPurpose;
  termsVersion: string;
  grantedAt: Date;
  revokedAt: Date | null;
};

export class LgpdConsent {
  static readonly termsVersionMaxLength = 20;

  private constructor(private readonly props: LgpdConsentProps) {}

  static grant(patientId: string, purpose: ConsentPurpose, termsVersion: string, at: Date): LgpdConsent {
    if (!patientId) {
      throw new DomainError('patientId is required');
    }
    if (!consentPurposes.includes(purpose)) {
      throw new DomainError(`purpose must be one of ${consentPurposes.join(', ')}`);
    }
    const version = typeof termsVersion === 'string' ? termsVersion.trim() : '';
    if (!version || version.length > LgpdConsent.termsVersionMaxLength) {
      throw new DomainError(`termsVersion must have between 1 and ${LgpdConsent.termsVersionMaxLength} characters`);
    }

    return new LgpdConsent({ id: randomUUID(), patientId, purpose, termsVersion: version, grantedAt: at, revokedAt: null });
  }

  static restore(props: LgpdConsentProps): LgpdConsent {
    return new LgpdConsent({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get patientId() {
    return this.props.patientId;
  }

  get purpose() {
    return this.props.purpose;
  }

  get termsVersion() {
    return this.props.termsVersion;
  }

  get grantedAt() {
    return this.props.grantedAt;
  }

  get revokedAt() {
    return this.props.revokedAt;
  }

  isActive(): boolean {
    return this.props.revokedAt === null;
  }

  revoke(at: Date): void {
    if (!this.isActive()) {
      throw new DomainError('Consent has already been revoked');
    }
    if (at.getTime() < this.props.grantedAt.getTime()) {
      throw new DomainError('revokedAt must not be before grantedAt');
    }
    this.props.revokedAt = at;
  }
}
