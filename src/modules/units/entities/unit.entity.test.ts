import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { Address, type AddressInput } from '../../../shared/value-objects/address';
import { Cnpj, Unit, type CreateUnitProps, type UnitProps, type UnitType } from './unit.entity';

const now = new Date('2026-10-11T12:00:00.000Z');

function addressInput(overrides: Partial<AddressInput> = {}): AddressInput {
  return {
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310-100',
    ...overrides,
  };
}

function validProps(overrides: Partial<CreateUnitProps> = {}): CreateUnitProps {
  return { name: 'Clínica Vida Plus Paulista', type: 'CLINIC', cnpj: '11.222.333/0001-81', address: addressInput(), ...overrides };
}

function storedProps(overrides: Partial<UnitProps> = {}): UnitProps {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Hospital Vida Plus Centro',
    type: 'HOSPITAL',
    cnpj: Cnpj.restore('11222333000181'),
    address: Address.create(addressInput()),
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Cnpj', () => {
  it('accepts a numeric CNPJ without mask', () => {
    expect(Cnpj.create('11222333000181').value).toBe('11222333000181');
  });

  it('accepts a numeric CNPJ with mask and stores it unmasked', () => {
    expect(Cnpj.create('11.222.333/0001-81').value).toBe('11222333000181');
  });

  it('accepts the official alphanumeric example', () => {
    expect(Cnpj.create('12.ABC.345/01DE-35').value).toBe('12ABC34501DE35');
  });

  it('accepts an unmasked alphanumeric CNPJ', () => {
    expect(Cnpj.create('12ABC34501DE35').value).toBe('12ABC34501DE35');
  });

  it('converts lowercase letters to uppercase', () => {
    expect(Cnpj.create('12.abc.345/01de-35').value).toBe('12ABC34501DE35');
  });

  it.each(['11.222.333/0001-82', '11222333000191', '12ABC34501DE36'])('rejects the wrong check digits in %j', (raw) => {
    expect(() => Cnpj.create(raw)).toThrow(new DomainError('cnpj has invalid check digits'));
  });

  it.each(['1122233300018', '112223330001811'])('rejects %j for not having 14 positions', (raw) => {
    expect(() => Cnpj.create(raw)).toThrow(DomainError);
  });

  it.each(['12ABC34501DEA5', '12ABC34501DE3B'])('rejects a letter in the check digit positions of %j', (raw) => {
    expect(() => Cnpj.create(raw)).toThrow(DomainError);
  });

  it.each(['00.000.000/0000-00', '00000000000000'])('rejects 14 repeated characters in %j', (raw) => {
    expect(() => Cnpj.create(raw)).toThrow(new DomainError('cnpj must not repeat a single character'));
  });

  it.each(['', '11 222 333 0001 81', '11#222333000181'])('rejects the malformed value %j', (raw) => {
    expect(() => Cnpj.create(raw)).toThrow(DomainError);
  });

  it('formats with the mask', () => {
    expect(Cnpj.create('12ABC34501DE35').formatted()).toBe('12.ABC.345/01DE-35');
  });

  it('considers masked and unmasked forms equal', () => {
    expect(Cnpj.create('11.222.333/0001-81').equals(Cnpj.create('11222333000181'))).toBe(true);
  });
});

describe('Unit.create', () => {
  it('generates a UUID id and starts active', () => {
    const unit = Unit.create(validProps(), now);

    expect(unit.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(unit.active).toBe(true);
    expect(unit.isActive()).toBe(true);
    expect(unit.createdAt).toEqual(now);
  });

  it('generates a different id for each unit', () => {
    expect(Unit.create(validProps()).id).not.toBe(Unit.create(validProps()).id);
  });

  it('stores the trimmed name, the unmasked CNPJ and the normalized address', () => {
    const unit = Unit.create(validProps({ name: '  Clínica Centro  ' }));

    expect(unit.name).toBe('Clínica Centro');
    expect(unit.cnpj.value).toBe('11222333000181');
    expect(unit.address.zipCode).toBe('01310100');
  });

  it.each(['', '   ', 'ab', '  ab  '])('rejects the short name %j', (name) => {
    expect(() => Unit.create(validProps({ name }))).toThrow(new DomainError('name must have between 3 and 120 characters'));
  });

  it('accepts names of exactly 3 and 120 characters', () => {
    expect(Unit.create(validProps({ name: 'abc' })).name).toBe('abc');
    expect(Unit.create(validProps({ name: 'a'.repeat(120) })).name).toHaveLength(120);
  });

  it('rejects a name longer than 120 characters', () => {
    expect(() => Unit.create(validProps({ name: 'a'.repeat(121) }))).toThrow(DomainError);
  });

  it('rejects an unknown type', () => {
    expect(() => Unit.create(validProps({ type: 'PHARMACY' as UnitType }))).toThrow(DomainError);
  });

  it('rejects an invalid CNPJ', () => {
    expect(() => Unit.create(validProps({ cnpj: '11.222.333/0001-82' }))).toThrow(new DomainError('cnpj has invalid check digits'));
  });

  it('rejects an invalid address', () => {
    expect(() => Unit.create(validProps({ address: addressInput({ state: 'XX' }) }))).toThrow(DomainError);
  });
});

describe('Unit.restore', () => {
  it('rebuilds the unit without revalidating', () => {
    const props = storedProps({ name: 'x', active: false });

    const unit = Unit.restore(props);

    expect(unit).toBeInstanceOf(Unit);
    expect(unit.name).toBe('x');
    expect(unit.active).toBe(false);
    expect(unit.id).toBe(props.id);
  });

  it('does not share state with the given props', () => {
    const props = storedProps();

    Unit.restore(props).update({ name: 'Hospital Renomeado' });

    expect(props.name).toBe('Hospital Vida Plus Centro');
  });
});

describe('Unit.update', () => {
  it('changes the name and the address', () => {
    const unit = Unit.restore(storedProps());

    unit.update({ name: ' Hospital Novo ', address: addressInput({ city: 'Campinas', zipCode: '13010-000' }) });

    expect(unit.name).toBe('Hospital Novo');
    expect(unit.address.city).toBe('Campinas');
    expect(unit.address.zipCode).toBe('13010000');
  });

  it('keeps the fields that were not given', () => {
    const unit = Unit.restore(storedProps());

    unit.update({ name: 'Hospital Novo' });

    expect(unit.address.city).toBe('São Paulo');
  });

  it('rejects an invalid name and keeps the unit unchanged', () => {
    const unit = Unit.restore(storedProps());

    expect(() => unit.update({ name: 'ab', address: addressInput({ city: 'Campinas' }) })).toThrow(DomainError);
    expect(unit.name).toBe('Hospital Vida Plus Centro');
    expect(unit.address.city).toBe('São Paulo');
  });

  it('rejects an invalid address', () => {
    expect(() => Unit.restore(storedProps()).update({ address: addressInput({ zipCode: '123' }) })).toThrow(DomainError);
  });

  it('rejects an inactive unit', () => {
    const unit = Unit.restore(storedProps({ active: false }));

    expect(() => unit.update({ name: 'Hospital Novo' })).toThrow(new DomainError('Unit is inactive'));
    expect(unit.name).toBe('Hospital Vida Plus Centro');
  });
});

describe('Unit.deactivate', () => {
  it('marks the unit inactive', () => {
    const unit = Unit.restore(storedProps());

    unit.deactivate();

    expect(unit.isActive()).toBe(false);
  });

  it('is idempotent', () => {
    const unit = Unit.restore(storedProps({ active: false }));

    expect(() => unit.deactivate()).not.toThrow();
    expect(unit.isActive()).toBe(false);
  });
});

describe('Unit.isLaboratory', () => {
  it('is true for a laboratory', () => {
    expect(Unit.restore(storedProps({ type: 'LABORATORY' })).isLaboratory()).toBe(true);
  });

  it.each(['HOSPITAL', 'CLINIC', 'HOME_CARE'] as const)('is false for %s', (type) => {
    expect(Unit.restore(storedProps({ type })).isLaboratory()).toBe(false);
  });
});
