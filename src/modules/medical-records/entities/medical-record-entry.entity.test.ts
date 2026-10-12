import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import {
  IcdCode,
  MedicalRecordEntry,
  type CorrectMedicalRecordEntryProps,
  type CreateMedicalRecordEntryProps,
  type MedicalRecordEntryProps,
} from './medical-record-entry.entity';

const now = new Date('2026-10-12T13:00:00.000Z');
const later = new Date('2026-10-13T09:00:00.000Z');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function validProps(overrides: Partial<CreateMedicalRecordEntryProps> = {}): CreateMedicalRecordEntryProps {
  return {
    patientId: '11111111-1111-4111-8111-111111111111',
    professionalId: '22222222-2222-4222-8222-222222222222',
    appointmentId: '33333333-3333-4333-8333-333333333333',
    anamnesis: 'Paciente relata tosse seca há 5 dias',
    icdCode: 'J45.0',
    diagnosisNotes: 'Asma com predominância alérgica',
    conduct: 'Broncodilatador, retorno em 15 dias',
    ...overrides,
  };
}

function correctionProps(overrides: Partial<CorrectMedicalRecordEntryProps> = {}): CorrectMedicalRecordEntryProps {
  return {
    anamnesis: 'Paciente relata tosse seca há 7 dias',
    icdCode: 'J45.1',
    diagnosisNotes: null,
    conduct: 'Broncodilatador e corticoide inalatório',
    correctionReason: 'Duração e CID registrados errados',
    ...overrides,
  };
}

describe('IcdCode', () => {
  it.each(['J45', 'J45.0', 'A00.1', ' Z99.9 '])('accepts %j', (raw) => {
    expect(IcdCode.create(raw).value).toBe(raw.trim());
  });

  it.each(['XYZ', 'J4', 'j45.0', 'J45.', 'J45.00', 'J450', '45.0'])('rejects %j', (raw) => {
    expect(() => IcdCode.create(raw)).toThrow(new DomainError('icdCode must be an ICD-10 code such as J45 or J45.0'));
  });

  it.each(['', '   '])('rejects the empty value %j', (raw) => {
    expect(() => IcdCode.create(raw)).toThrow(new DomainError('icdCode is required'));
  });

  it('compares by value', () => {
    expect(IcdCode.create('J45.0').equals(IcdCode.create(' J45.0'))).toBe(true);
    expect(IcdCode.create('J45.0').equals(IcdCode.create('J45'))).toBe(false);
  });
});

describe('MedicalRecordEntry.create', () => {
  it('generates the id and createdAt and trims the content', () => {
    const entry = MedicalRecordEntry.create(validProps({ anamnesis: '  Tosse seca  ' }), now);

    expect(entry.id).toMatch(uuidPattern);
    expect(entry.createdAt).toEqual(now);
    expect(entry.anamnesis).toBe('Tosse seca');
    expect(entry.icdCode.value).toBe('J45.0');
    expect(entry.diagnosisNotes).toBe('Asma com predominância alérgica');
    expect(entry.previousEntryId).toBeNull();
    expect(entry.correctionReason).toBeNull();
    expect(entry.admissionId).toBeNull();
  });

  it('generates a different id for each entry', () => {
    expect(MedicalRecordEntry.create(validProps(), now).id).not.toBe(MedicalRecordEntry.create(validProps(), now).id);
  });

  it.each(['anamnesis', 'conduct'] as const)('requires %s', (field) => {
    expect(() => MedicalRecordEntry.create(validProps({ [field]: '  ' }), now)).toThrow(new DomainError(`${field} is required`));
  });

  it('requires the ICD code', () => {
    expect(() => MedicalRecordEntry.create(validProps({ icdCode: '' }), now)).toThrow(new DomainError('icdCode is required'));
  });

  it('rejects an invalid ICD code', () => {
    expect(() => MedicalRecordEntry.create(validProps({ icdCode: 'XYZ' }), now)).toThrow(DomainError);
  });

  it.each(['patientId', 'professionalId'] as const)('requires %s', (field) => {
    expect(() => MedicalRecordEntry.create(validProps({ [field]: '' }), now)).toThrow(new DomainError(`${field} is required`));
  });

  it('stores blank diagnosis notes as null', () => {
    expect(MedicalRecordEntry.create(validProps({ diagnosisNotes: '   ' }), now).diagnosisNotes).toBeNull();
    expect(MedicalRecordEntry.create(validProps({ diagnosisNotes: undefined }), now).diagnosisNotes).toBeNull();
  });

  it.each([
    ['anamnesis', MedicalRecordEntry.anamnesisMaxLength],
    ['conduct', MedicalRecordEntry.conductMaxLength],
    ['diagnosisNotes', MedicalRecordEntry.diagnosisNotesMaxLength],
  ] as const)('limits %s to %i characters', (field, max) => {
    expect(() => MedicalRecordEntry.create(validProps({ [field]: 'a'.repeat(max) }), now)).not.toThrow();
    expect(() => MedicalRecordEntry.create(validProps({ [field]: 'a'.repeat(max + 1) }), now)).toThrow(
      new DomainError(`${field} must have at most ${max} characters`),
    );
  });

  it('accepts an admission as the only origin', () => {
    const entry = MedicalRecordEntry.create(validProps({ appointmentId: null, admissionId: '44444444-4444-4444-8444-444444444444' }), now);

    expect(entry.appointmentId).toBeNull();
    expect(entry.admissionId).toBe('44444444-4444-4444-8444-444444444444');
  });

  it.each([
    ['no origin', { appointmentId: null, admissionId: null }],
    ['two origins', { admissionId: '44444444-4444-4444-8444-444444444444' }],
  ])('rejects %s', (_, origin) => {
    expect(() => MedicalRecordEntry.create(validProps(origin), now)).toThrow(
      new DomainError('Exactly one origin is required: appointmentId or admissionId'),
    );
  });
});

describe('MedicalRecordEntry.correct', () => {
  it('returns a new entry pointing to the original', () => {
    const original = MedicalRecordEntry.create(validProps(), now);

    const correction = original.correct(correctionProps(), later);

    expect(correction).not.toBe(original);
    expect(correction.id).toMatch(uuidPattern);
    expect(correction.id).not.toBe(original.id);
    expect(correction.previousEntryId).toBe(original.id);
    expect(correction.createdAt).toEqual(later);
    expect(correction.anamnesis).toBe('Paciente relata tosse seca há 7 dias');
    expect(correction.icdCode.value).toBe('J45.1');
    expect(correction.diagnosisNotes).toBeNull();
    expect(correction.correctionReason).toBe('Duração e CID registrados errados');
  });

  it('inherits patient, origin and author', () => {
    const original = MedicalRecordEntry.create(validProps(), now);

    const correction = original.correct(correctionProps(), later);

    expect(correction.patientId).toBe(original.patientId);
    expect(correction.professionalId).toBe(original.professionalId);
    expect(correction.appointmentId).toBe(original.appointmentId);
    expect(correction.admissionId).toBe(original.admissionId);
  });

  it('leaves the original unchanged', () => {
    const original = MedicalRecordEntry.create(validProps(), now);
    const before = { ...original, icdCode: original.icdCode.value, anamnesis: original.anamnesis, conduct: original.conduct };

    original.correct(correctionProps(), later);

    expect({ ...original, icdCode: original.icdCode.value, anamnesis: original.anamnesis, conduct: original.conduct }).toEqual(before);
    expect(original.previousEntryId).toBeNull();
    expect(original.correctionReason).toBeNull();
  });

  it.each(['', '   ', undefined])('requires the correction reason (%j)', (correctionReason) => {
    const original = MedicalRecordEntry.create(validProps(), now);

    expect(() => original.correct(correctionProps({ correctionReason: correctionReason as string }), later)).toThrow(
      new DomainError('correctionReason is required'),
    );
  });

  it('limits the correction reason length', () => {
    const original = MedicalRecordEntry.create(validProps(), now);
    const correctionReason = 'a'.repeat(MedicalRecordEntry.correctionReasonMaxLength + 1);

    expect(() => original.correct(correctionProps({ correctionReason }), later)).toThrow(DomainError);
  });

  it('validates the corrected content', () => {
    const original = MedicalRecordEntry.create(validProps(), now);

    expect(() => original.correct(correctionProps({ conduct: ' ' }), later)).toThrow(new DomainError('conduct is required'));
    expect(() => original.correct(correctionProps({ icdCode: 'j45' }), later)).toThrow(DomainError);
  });

  it('chains a correction of a correction', () => {
    const original = MedicalRecordEntry.create(validProps(), now);
    const first = original.correct(correctionProps(), later);

    const second = first.correct(correctionProps({ correctionReason: 'Conduta incompleta' }), later);

    expect(second.previousEntryId).toBe(first.id);
    expect(second.appointmentId).toBe(original.appointmentId);
  });
});

describe('MedicalRecordEntry.restore', () => {
  it('rebuilds the entry without revalidating', () => {
    const props: MedicalRecordEntryProps = {
      id: 'legacy-id',
      patientId: '',
      professionalId: '',
      appointmentId: null,
      admissionId: null,
      previousEntryId: null,
      anamnesis: '',
      icdCode: IcdCode.restore('not-an-icd'),
      diagnosisNotes: null,
      conduct: '',
      correctionReason: 'orphan reason',
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    };

    const entry = MedicalRecordEntry.restore(props);

    expect(entry).toBeInstanceOf(MedicalRecordEntry);
    expect(entry.id).toBe('legacy-id');
    expect(entry.icdCode.value).toBe('not-an-icd');
    expect(entry.correctionReason).toBe('orphan reason');
  });
});

describe('MedicalRecordEntry.isAuthoredBy', () => {
  it('is true only for the author', () => {
    const entry = MedicalRecordEntry.create(validProps(), now);

    expect(entry.isAuthoredBy(validProps().professionalId)).toBe(true);
    expect(entry.isAuthoredBy('55555555-5555-4555-8555-555555555555')).toBe(false);
  });
});

describe('MedicalRecordEntry', () => {
  it('exposes no method that changes its content', () => {
    const instanceMethods = Object.getOwnPropertyNames(MedicalRecordEntry.prototype).filter((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(MedicalRecordEntry.prototype, name);
      return name !== 'constructor' && typeof descriptor?.value === 'function';
    });

    expect(instanceMethods.sort()).toEqual(['correct', 'isAuthoredBy']);
  });
});
