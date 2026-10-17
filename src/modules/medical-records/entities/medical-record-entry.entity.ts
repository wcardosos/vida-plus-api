import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export function requiredText(field: string, raw: unknown, maxLength: number): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw new DomainError(`${field} is required`);
  }
  if (value.length > maxLength) {
    throw new DomainError(`${field} must have at most ${maxLength} characters`);
  }
  return value;
}

function optionalText(field: string, raw: unknown, maxLength: number): string | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length > maxLength) {
    throw new DomainError(`${field} must have at most ${maxLength} characters`);
  }
  return value || null;
}

export class IcdCode {
  static readonly pattern = /^[A-Z]\d{2}(\.\d)?$/;

  private constructor(readonly value: string) {}

  static create(raw: string): IcdCode {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      throw new DomainError('icdCode is required');
    }
    if (!IcdCode.pattern.test(value)) {
      throw new DomainError('icdCode must be an ICD-10 code such as J45 or J45.0');
    }
    return new IcdCode(value);
  }

  static restore(value: string): IcdCode {
    return new IcdCode(value);
  }

  equals(other: IcdCode): boolean {
    return this.value === other.value;
  }
}

export type MedicalRecordEntryProps = {
  id: string;
  patientId: string;
  professionalId: string;
  appointmentId: string | null;
  admissionId: string | null;
  previousEntryId: string | null;
  anamnesis: string;
  icdCode: IcdCode;
  diagnosisNotes: string | null;
  conduct: string;
  correctionReason: string | null;
  createdAt: Date;
};

export type ClinicalContent = {
  anamnesis: string;
  icdCode: string;
  diagnosisNotes?: string | null;
  conduct: string;
};

export type CreateMedicalRecordEntryProps = ClinicalContent & {
  patientId: string;
  professionalId: string;
  appointmentId?: string | null;
  admissionId?: string | null;
};

export type CorrectMedicalRecordEntryProps = ClinicalContent & {
  correctionReason: string;
};

function validContent(content: ClinicalContent) {
  return {
    anamnesis: requiredText('anamnesis', content.anamnesis, MedicalRecordEntry.anamnesisMaxLength),
    icdCode: IcdCode.create(content.icdCode),
    diagnosisNotes: optionalText('diagnosisNotes', content.diagnosisNotes, MedicalRecordEntry.diagnosisNotesMaxLength),
    conduct: requiredText('conduct', content.conduct, MedicalRecordEntry.conductMaxLength),
  };
}

export class MedicalRecordEntry {
  static readonly anamnesisMaxLength = 10_000;
  static readonly diagnosisNotesMaxLength = 2_000;
  static readonly conductMaxLength = 5_000;
  static readonly correctionReasonMaxLength = 1_000;

  private constructor(private readonly props: MedicalRecordEntryProps) {}

  static create(props: CreateMedicalRecordEntryProps, now: Date): MedicalRecordEntry {
    for (const field of ['patientId', 'professionalId'] as const) {
      if (!props[field]) {
        throw new DomainError(`${field} is required`);
      }
    }
    const appointmentId = props.appointmentId || null;
    const admissionId = props.admissionId || null;
    if ((appointmentId === null) === (admissionId === null)) {
      throw new DomainError('Exactly one origin is required: appointmentId or admissionId');
    }

    return new MedicalRecordEntry({
      id: randomUUID(),
      patientId: props.patientId,
      professionalId: props.professionalId,
      appointmentId,
      admissionId,
      previousEntryId: null,
      ...validContent(props),
      correctionReason: null,
      createdAt: now,
    });
  }

  static restore(props: MedicalRecordEntryProps): MedicalRecordEntry {
    return new MedicalRecordEntry({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get patientId() {
    return this.props.patientId;
  }

  get professionalId() {
    return this.props.professionalId;
  }

  get appointmentId() {
    return this.props.appointmentId;
  }

  get admissionId() {
    return this.props.admissionId;
  }

  get previousEntryId() {
    return this.props.previousEntryId;
  }

  get anamnesis() {
    return this.props.anamnesis;
  }

  get icdCode() {
    return this.props.icdCode;
  }

  get diagnosisNotes() {
    return this.props.diagnosisNotes;
  }

  get conduct() {
    return this.props.conduct;
  }

  get correctionReason() {
    return this.props.correctionReason;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  isAuthoredBy(professionalId: string): boolean {
    return this.props.professionalId === professionalId;
  }

  isCorrection(): boolean {
    return this.props.previousEntryId !== null;
  }

  correct(props: CorrectMedicalRecordEntryProps, now: Date): MedicalRecordEntry {
    const correctionReason = requiredText('correctionReason', props.correctionReason, MedicalRecordEntry.correctionReasonMaxLength);
    return new MedicalRecordEntry({
      id: randomUUID(),
      patientId: this.props.patientId,
      professionalId: this.props.professionalId,
      appointmentId: this.props.appointmentId,
      admissionId: this.props.admissionId,
      previousEntryId: this.props.id,
      ...validContent(props),
      correctionReason,
      createdAt: now,
    });
  }
}
