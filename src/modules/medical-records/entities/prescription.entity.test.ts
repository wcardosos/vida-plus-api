import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { PrescriptionItem, type PrescriptionItemInput } from './prescription-item.entity';
import { Prescription, type IssuePrescriptionProps, type PrescriptionProps } from './prescription.entity';

const timeZone = 'America/Sao_Paulo';
const now = new Date('2026-10-12T13:00:00.000Z');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const physician = { id: '22222222-2222-4222-8222-222222222222', canPrescribe: () => true };
const nurse = { id: '33333333-3333-4333-8333-333333333333', canPrescribe: () => false };

function item(overrides: Partial<PrescriptionItemInput> = {}): PrescriptionItemInput {
  return {
    medication: 'Salbutamol 100 mcg',
    dose: '2 jatos',
    dosageInstructions: 'de 6 em 6 horas se falta de ar',
    duration: '15 dias',
    ...overrides,
  };
}

function validProps(overrides: Partial<IssuePrescriptionProps> = {}): IssuePrescriptionProps {
  return {
    medicalRecordEntryId: '11111111-1111-4111-8111-111111111111',
    patientId: '44444444-4444-4444-8444-444444444444',
    prescriber: physician,
    validUntil: '2026-11-12',
    items: [item(), item({ medication: 'Prednisolona 20 mg', dose: '1 comprimido', dosageInstructions: 'pela manhã', duration: '5 dias' })],
    ...overrides,
  };
}

describe('Prescription.issue', () => {
  it('issues the prescription with ordered items', () => {
    const prescription = Prescription.issue(validProps(), now, timeZone);

    expect(prescription.id).toMatch(uuidPattern);
    expect(prescription.prescriberId).toBe(physician.id);
    expect(prescription.issuedAt).toEqual(now);
    expect(prescription.validUntil).toBe('2026-11-12');
    expect(prescription.getItems().map((entry) => [entry.position, entry.medication])).toEqual([
      [1, 'Salbutamol 100 mcg'],
      [2, 'Prednisolona 20 mg'],
    ]);
  });

  it('generates a 10-character base32 verification code', () => {
    const codes = new Set(Array.from({ length: 50 }, () => Prescription.issue(validProps(), now, timeZone).verificationCode));

    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{10}$/);
    }
    expect(codes.size).toBe(50);
  });

  it('rejects a prescriber that cannot prescribe', () => {
    expect(() => Prescription.issue(validProps({ prescriber: nurse }), now, timeZone)).toThrow(
      new DomainError('Only physicians can issue prescriptions'),
    );
  });

  it('rejects a prescription without items', () => {
    expect(() => Prescription.issue(validProps({ items: [] }), now, timeZone)).toThrow(new DomainError('Prescription must have at least one item'));
  });

  it.each([
    ['in the past', '2026-10-01'],
    ['on the issue date', '2026-10-12'],
  ])('rejects a validity %s', (_, validUntil) => {
    expect(() => Prescription.issue(validProps({ validUntil }), now, timeZone)).toThrow(new DomainError('validUntil must be after the issue date'));
  });

  it('compares the validity with the issue date in the time zone', () => {
    const lateEvening = new Date('2026-10-13T01:00:00.000Z');

    expect(() => Prescription.issue(validProps({ validUntil: '2026-10-13' }), lateEvening, timeZone)).not.toThrow();
  });

  it.each(['2026-02-30', '12/11/2026', ''])('rejects the invalid date %j', (validUntil) => {
    expect(() => Prescription.issue(validProps({ validUntil }), now, timeZone)).toThrow(
      new DomainError('validUntil must be a valid date in YYYY-MM-DD format'),
    );
  });

  it('rejects an item with a blank field, naming it', () => {
    const items = [item(), item({ dosageInstructions: '  ' })];

    expect(() => Prescription.issue(validProps({ items }), now, timeZone)).toThrow(new DomainError('items[1].dosageInstructions is required'));
  });

  it.each(['medicalRecordEntryId', 'patientId'] as const)('requires %s', (field) => {
    expect(() => Prescription.issue(validProps({ [field]: '' }), now, timeZone)).toThrow(new DomainError(`${field} is required`));
  });
});

describe('Prescription.getItems', () => {
  it('returns a list that does not change the prescription when modified', () => {
    const prescription = Prescription.issue(validProps(), now, timeZone);

    const items = prescription.getItems();
    items.pop();
    items.push(PrescriptionItem.create(item({ medication: 'Intruso' }), 9));

    expect(prescription.getItems().map((entry) => entry.medication)).toEqual(['Salbutamol 100 mcg', 'Prednisolona 20 mg']);
  });
});

describe('Prescription.restore', () => {
  it('rebuilds without revalidating and orders the items by position', () => {
    const second = PrescriptionItem.restore({ id: 'b', position: 2, ...item({ medication: 'B' }) });
    const first = PrescriptionItem.restore({ id: 'a', position: 1, ...item({ medication: 'A' }) });
    const props: PrescriptionProps = {
      id: 'legacy-id',
      medicalRecordEntryId: 'entry',
      patientId: 'patient',
      prescriberId: 'nurse',
      issuedAt: new Date('2020-01-01T00:00:00.000Z'),
      validUntil: '2020-01-02',
      verificationCode: 'ABC',
      items: [second, first],
    };

    const prescription = Prescription.restore(props);

    expect(prescription.validUntil).toBe('2020-01-02');
    expect(prescription.getItems().map((entry) => entry.medication)).toEqual(['A', 'B']);
  });
});
