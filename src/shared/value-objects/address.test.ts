import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { Address, type AddressInput } from './address';

function validInput(overrides: Partial<AddressInput> = {}): AddressInput {
  return {
    street: 'Avenida Paulista',
    number: '1000',
    complement: 'Sala 12',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310100',
    ...overrides,
  };
}

describe('Address.create', () => {
  it('keeps every field of a valid address', () => {
    expect(Address.create(validInput()).toProps()).toEqual({
      street: 'Avenida Paulista',
      number: '1000',
      complement: 'Sala 12',
      district: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01310100',
    });
  });

  it('trims the text fields', () => {
    const address = Address.create(validInput({ street: '  Rua A  ', city: ' Recife ' }));

    expect(address.street).toBe('Rua A');
    expect(address.city).toBe('Recife');
  });

  it.each([undefined, null, '', '   '])('treats the complement %j as absent', (complement) => {
    expect(Address.create(validInput({ complement })).complement).toBeNull();
  });

  it('accepts a textual number such as s/n', () => {
    expect(Address.create(validInput({ number: 's/n' })).number).toBe('s/n');
  });

  it.each(['street', 'number', 'district', 'city'] as const)('requires %s', (field) => {
    expect(() => Address.create(validInput({ [field]: '  ' }))).toThrow(new DomainError(`address.${field} is required`));
  });

  it('rejects a street longer than 150 characters', () => {
    expect(() => Address.create(validInput({ street: 'a'.repeat(151) }))).toThrow(DomainError);
  });

  it('rejects a complement longer than 100 characters', () => {
    expect(() => Address.create(validInput({ complement: 'a'.repeat(101) }))).toThrow(DomainError);
  });

  it('normalizes the state to uppercase', () => {
    expect(Address.create(validInput({ state: ' rj ' })).state).toBe('RJ');
  });

  it.each(['XX', 'S', 'SPP', ''])('rejects the nonexistent state %j', (state) => {
    expect(() => Address.create(validInput({ state }))).toThrow(new DomainError('address.state must be a valid Brazilian state abbreviation'));
  });

  it('normalizes a zip code with a hyphen', () => {
    expect(Address.create(validInput({ zipCode: '01310-100' })).zipCode).toBe('01310100');
  });

  it.each(['0131010', '013101000', '01310-10', '0131A100', '01.310-100'])('rejects the zip code %j', (zipCode) => {
    expect(() => Address.create(validInput({ zipCode }))).toThrow(new DomainError('address.zipCode must have 8 digits'));
  });
});

describe('Address.restore', () => {
  it('rebuilds the address without revalidating', () => {
    const props = { ...Address.create(validInput()).toProps(), zipCode: 'legacy' };

    expect(Address.restore(props).zipCode).toBe('legacy');
  });
});
