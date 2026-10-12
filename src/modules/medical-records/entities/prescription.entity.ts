import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { toZonedDate } from '../../../shared/time-zone';
import { PrescriptionItem, type PrescriptionItemInput } from './prescription-item.entity';

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return datePattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function generateVerificationCode(): string {
  return [...randomBytes(Prescription.verificationCodeLength)].map((byte) => base32Alphabet[byte % 32]).join('');
}

export type Prescriber = {
  id: string;
  canPrescribe(): boolean;
};

export type PrescriptionProps = {
  id: string;
  medicalRecordEntryId: string;
  patientId: string;
  prescriberId: string;
  issuedAt: Date;
  validUntil: string;
  verificationCode: string;
  items: PrescriptionItem[];
};

export type IssuePrescriptionProps = {
  medicalRecordEntryId: string;
  patientId: string;
  prescriber: Prescriber;
  validUntil: string;
  items: readonly PrescriptionItemInput[];
};

export class Prescription {
  static readonly verificationCodeLength = 10;

  private constructor(private readonly props: PrescriptionProps) {}

  static issue(props: IssuePrescriptionProps, now: Date, timeZone: string): Prescription {
    for (const field of ['medicalRecordEntryId', 'patientId'] as const) {
      if (!props[field]) {
        throw new DomainError(`${field} is required`);
      }
    }
    if (!props.prescriber?.id) {
      throw new DomainError('prescriber is required');
    }
    if (!props.prescriber.canPrescribe()) {
      throw new DomainError('Only physicians can issue prescriptions');
    }
    const validUntil = typeof props.validUntil === 'string' ? props.validUntil.trim() : '';
    if (!isValidDate(validUntil)) {
      throw new DomainError('validUntil must be a valid date in YYYY-MM-DD format');
    }
    if (validUntil <= toZonedDate(now, timeZone)) {
      throw new DomainError('validUntil must be after the issue date');
    }
    if (!Array.isArray(props.items) || props.items.length === 0) {
      throw new DomainError('Prescription must have at least one item');
    }

    return new Prescription({
      id: randomUUID(),
      medicalRecordEntryId: props.medicalRecordEntryId,
      patientId: props.patientId,
      prescriberId: props.prescriber.id,
      issuedAt: now,
      validUntil,
      verificationCode: generateVerificationCode(),
      items: props.items.map((item, index) => PrescriptionItem.create(item, index + 1)),
    });
  }

  static restore(props: PrescriptionProps): Prescription {
    return new Prescription({ ...props, items: [...props.items].sort((a, b) => a.position - b.position) });
  }

  get id() {
    return this.props.id;
  }

  get medicalRecordEntryId() {
    return this.props.medicalRecordEntryId;
  }

  get patientId() {
    return this.props.patientId;
  }

  get prescriberId() {
    return this.props.prescriberId;
  }

  get issuedAt() {
    return this.props.issuedAt;
  }

  get validUntil() {
    return this.props.validUntil;
  }

  get verificationCode() {
    return this.props.verificationCode;
  }

  getItems(): PrescriptionItem[] {
    return [...this.props.items];
  }
}
