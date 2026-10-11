import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { Address, type AddressInput } from '../../../shared/value-objects/address';
import { Cpf, Patient, type CreatePatientProps, type PatientProps } from './patient.entity';

const now = new Date('2026-10-11T12:00:00.000Z');

function addressInput(overrides: Partial<AddressInput> = {}): AddressInput {
  return { street: 'Rua A', number: '10', district: 'Centro', city: 'Guarabira', state: 'PB', zipCode: '58200-000', ...overrides };
}

function validProps(overrides: Partial<CreatePatientProps> = {}): CreatePatientProps {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Maria da Silva',
    cpf: '529.982.247-25',
    birthDate: '1990-04-12',
    phone: '83999990000',
    address: addressInput(),
    acceptTerms: true,
    termsVersion: '2026-10',
    ...overrides,
  };
}

function storedProps(overrides: Partial<PatientProps> = {}): PatientProps {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Maria da Silva',
    cpf: Cpf.restore('52998224725'),
    birthDate: '1990-04-12',
    phone: '83999990000',
    address: Address.create(addressInput()),
    termsVersion: '2026-10',
    termsAcceptedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Cpf', () => {
  it('accepts a valid CPF without mask', () => {
    expect(Cpf.create('52998224725').value).toBe('52998224725');
  });

  it('accepts a valid CPF with mask and stores it unmasked', () => {
    expect(Cpf.create(' 529.982.247-25 ').value).toBe('52998224725');
  });

  it.each(['529.982.247-26', '52998224715'])('rejects the wrong check digits in %j', (raw) => {
    expect(() => Cpf.create(raw)).toThrow(new DomainError('cpf has invalid check digits'));
  });

  it.each(['5299822472', '529982247250'])('rejects %j for not having 11 digits', (raw) => {
    expect(() => Cpf.create(raw)).toThrow(new DomainError('cpf must have 11 digits'));
  });

  it.each(['111.111.111-11', '00000000000'])('rejects the repeated sequence %j', (raw) => {
    expect(() => Cpf.create(raw)).toThrow(new DomainError('cpf must not repeat a single digit'));
  });

  it.each(['529.982.247-2A', 'abcdefghijk', '', '529 982 247 25'])('rejects the malformed value %j', (raw) => {
    expect(() => Cpf.create(raw)).toThrow(new DomainError('cpf must have 11 digits'));
  });

  it('formats with the mask', () => {
    expect(Cpf.create('52998224725').formatted()).toBe('529.982.247-25');
  });

  it('considers masked and unmasked forms equal', () => {
    expect(Cpf.create('529.982.247-25').equals(Cpf.create('52998224725'))).toBe(true);
  });
});

describe('Patient.create', () => {
  it('generates a UUID id and records the terms acceptance', () => {
    const patient = Patient.create(validProps(), now);

    expect(patient.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(patient.termsVersion).toBe('2026-10');
    expect(patient.termsAcceptedAt).toEqual(now);
    expect(patient.createdAt).toEqual(now);
  });

  it('generates a different id for each patient', () => {
    expect(Patient.create(validProps(), now).id).not.toBe(Patient.create(validProps(), now).id);
  });

  it('stores the normalized fields', () => {
    const patient = Patient.create(validProps({ name: '  Maria  ', phone: '(83) 99999-0000' }), now);

    expect(patient.name).toBe('Maria');
    expect(patient.cpf.value).toBe('52998224725');
    expect(patient.phone).toBe('83999990000');
    expect(patient.address.zipCode).toBe('58200000');
  });

  it.each(['', '   '])('rejects the empty name %j', (name) => {
    expect(() => Patient.create(validProps({ name }), now)).toThrow(new DomainError('name is required'));
  });

  it('rejects a name longer than 150 characters', () => {
    expect(() => Patient.create(validProps({ name: 'a'.repeat(151) }), now)).toThrow(DomainError);
  });

  it('accepts a birth date of today', () => {
    expect(Patient.create(validProps({ birthDate: '2026-10-11' }), now).birthDate).toBe('2026-10-11');
  });

  it('rejects a birth date of tomorrow', () => {
    expect(() => Patient.create(validProps({ birthDate: '2026-10-12' }), now)).toThrow(new DomainError('birthDate must not be in the future'));
  });

  it('takes today in Brasília time', () => {
    const lateEvening = new Date('2026-10-12T02:00:00.000Z');

    expect(() => Patient.create(validProps({ birthDate: '2026-10-12' }), lateEvening)).toThrow(DomainError);
  });

  it.each(['2026-02-30', '12/04/1990', '1990-4-12', ''])('rejects the invalid birth date %j', (birthDate) => {
    expect(() => Patient.create(validProps({ birthDate }), now)).toThrow(
      new DomainError('birthDate must be a valid date in YYYY-MM-DD format'),
    );
  });

  it('rejects an invalid CPF', () => {
    expect(() => Patient.create(validProps({ cpf: '111.111.111-11' }), now)).toThrow(DomainError);
  });

  it.each(['839999', '+55 83 99999-0000', 'abc'])('rejects the phone %j', (phone) => {
    expect(() => Patient.create(validProps({ phone }), now)).toThrow(
      new DomainError('phone must have 10 or 11 digits including the area code'),
    );
  });

  it('rejects an invalid address', () => {
    expect(() => Patient.create(validProps({ address: addressInput({ state: 'XX' }) }), now)).toThrow(DomainError);
  });

  it('rejects when the terms of use were not accepted', () => {
    expect(() => Patient.create(validProps({ acceptTerms: false }), now)).toThrow(new DomainError('The terms of use must be accepted'));
  });

  it('requires a terms version', () => {
    expect(() => Patient.create(validProps({ termsVersion: ' ' }), now)).toThrow(DomainError);
  });

  it('requires a user', () => {
    expect(() => Patient.create(validProps({ userId: '' }), now)).toThrow(new DomainError('userId is required'));
  });
});

describe('Patient.restore', () => {
  it('rebuilds the patient without revalidating', () => {
    const patient = Patient.restore(storedProps({ cpf: Cpf.restore('11111111111'), birthDate: '2999-01-01', name: '' }));

    expect(patient).toBeInstanceOf(Patient);
    expect(patient.cpf.value).toBe('11111111111');
    expect(patient.birthDate).toBe('2999-01-01');
  });

  it('does not share state with the given props', () => {
    const props = storedProps();

    Patient.restore(props).updateContactInfo({ name: 'Outra' });

    expect(props.name).toBe('Maria da Silva');
  });
});

describe('Patient.updateContactInfo', () => {
  it('changes name, phone and address and keeps CPF and birth date', () => {
    const patient = Patient.restore(storedProps());

    patient.updateContactInfo({ name: 'Maria Souza', phone: '8333334444', address: addressInput({ city: 'João Pessoa' }) });

    expect(patient.name).toBe('Maria Souza');
    expect(patient.phone).toBe('8333334444');
    expect(patient.address.city).toBe('João Pessoa');
    expect(patient.cpf.value).toBe('52998224725');
    expect(patient.birthDate).toBe('1990-04-12');
  });

  it('keeps the fields that were not given', () => {
    const patient = Patient.restore(storedProps());

    patient.updateContactInfo({ phone: '8333334444' });

    expect(patient.name).toBe('Maria da Silva');
    expect(patient.address.city).toBe('Guarabira');
  });

  it('rejects an invalid field and keeps the patient unchanged', () => {
    const patient = Patient.restore(storedProps());

    expect(() => patient.updateContactInfo({ name: 'Maria Souza', phone: '123' })).toThrow(DomainError);
    expect(patient.name).toBe('Maria da Silva');
  });
});

describe('Patient.correctIdentity', () => {
  it('replaces CPF and birth date', () => {
    const patient = Patient.restore(storedProps());

    patient.correctIdentity({ cpf: '111.444.777-35', birthDate: '1991-05-20' }, now);

    expect(patient.cpf.value).toBe('11144477735');
    expect(patient.birthDate).toBe('1991-05-20');
  });

  it('rejects an invalid CPF and keeps the patient unchanged', () => {
    const patient = Patient.restore(storedProps());

    expect(() => patient.correctIdentity({ cpf: '111.444.777-36', birthDate: '1991-05-20' }, now)).toThrow(
      new DomainError('cpf has invalid check digits'),
    );
    expect(patient.cpf.value).toBe('52998224725');
    expect(patient.birthDate).toBe('1990-04-12');
  });

  it('rejects a future birth date', () => {
    const patient = Patient.restore(storedProps());

    expect(() => patient.correctIdentity({ birthDate: '2026-10-12' }, now)).toThrow(new DomainError('birthDate must not be in the future'));
    expect(patient.birthDate).toBe('1990-04-12');
  });
});
