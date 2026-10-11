import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import {
  CouncilRegistration,
  Professional,
  type CouncilRegistrationInput,
  type CreateProfessionalProps,
  type ProfessionalCategory,
  type ProfessionalProps,
} from './professional.entity';

const now = new Date('2026-10-11T12:00:00.000Z');
const unitA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unitB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function registrationInput(overrides: Partial<CouncilRegistrationInput> = {}): CouncilRegistrationInput {
  return { council: 'CRM', number: '12345', state: 'PB', ...overrides };
}

function validProps(overrides: Partial<CreateProfessionalProps> = {}): CreateProfessionalProps {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Dra. Ana Lima',
    category: 'PHYSICIAN',
    registration: registrationInput(),
    specialty: 'Cardiologia',
    unitIds: [unitA],
    ...overrides,
  };
}

function storedProps(overrides: Partial<ProfessionalProps> = {}): ProfessionalProps {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Enf. Carlos Souza',
    category: 'NURSE',
    registration: CouncilRegistration.restore({ council: 'COREN', number: '98765', state: 'PE' }),
    specialty: null,
    unitIds: [unitA],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('CouncilRegistration', () => {
  it('normalizes council, number and state', () => {
    const registration = CouncilRegistration.create(registrationInput({ council: ' crm ', number: ' 12345 ', state: 'pb' }), 'PHYSICIAN');

    expect(registration.toProps()).toEqual({ council: 'CRM', number: '12345', state: 'PB' });
    expect(registration.formatted()).toBe('CRM 12345/PB');
  });

  it.each(['council', 'number', 'state'] as const)('requires %s', (field) => {
    expect(() => CouncilRegistration.create(registrationInput({ [field]: '  ' }), 'PHYSICIAN')).toThrow(
      new DomainError(`registration.${field} is required`),
    );
  });

  it('rejects an unknown council', () => {
    expect(() => CouncilRegistration.create(registrationInput({ council: 'CRO' }), 'PHYSICIAN')).toThrow(
      new DomainError('registration.council must be one of CRM, COREN'),
    );
  });

  it.each(['XX', 'P'])('rejects the nonexistent state %j', (state) => {
    expect(() => CouncilRegistration.create(registrationInput({ state }), 'PHYSICIAN')).toThrow(
      new DomainError('registration.state must be a valid Brazilian state abbreviation'),
    );
  });

  it.each(['12 345', '12/345', '1'.repeat(21)])('rejects the number %j', (number) => {
    expect(() => CouncilRegistration.create(registrationInput({ number }), 'PHYSICIAN')).toThrow(DomainError);
  });

  it('rejects a NURSE with CRM', () => {
    expect(() => CouncilRegistration.create(registrationInput({ council: 'CRM' }), 'NURSE')).toThrow(
      new DomainError('registration.council must be COREN for category NURSE'),
    );
  });

  it('rejects a PHYSICIAN with COREN', () => {
    expect(() => CouncilRegistration.create(registrationInput({ council: 'COREN' }), 'PHYSICIAN')).toThrow(
      new DomainError('registration.council must be CRM for category PHYSICIAN'),
    );
  });

  it('accepts a TECHNICIAN with COREN', () => {
    expect(CouncilRegistration.create(registrationInput({ council: 'COREN' }), 'TECHNICIAN').council).toBe('COREN');
  });

  it('considers registrations with the same council, number and state equal', () => {
    const a = CouncilRegistration.create(registrationInput(), 'PHYSICIAN');

    expect(a.equals(CouncilRegistration.create(registrationInput({ state: 'pb' }), 'PHYSICIAN'))).toBe(true);
    expect(a.equals(CouncilRegistration.create(registrationInput({ state: 'PE' }), 'PHYSICIAN'))).toBe(false);
  });
});

describe('Professional.create', () => {
  it('generates a UUID id and keeps the given data', () => {
    const professional = Professional.create(validProps({ name: '  Dra. Ana Lima ', unitIds: [unitA, unitB] }), now);

    expect(professional.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(professional.name).toBe('Dra. Ana Lima');
    expect(professional.category).toBe('PHYSICIAN');
    expect(professional.registration.formatted()).toBe('CRM 12345/PB');
    expect(professional.specialty).toBe('Cardiologia');
    expect(professional.unitIds).toEqual([unitA, unitB]);
    expect(professional.createdAt).toEqual(now);
  });

  it('generates a different id for each professional', () => {
    expect(Professional.create(validProps()).id).not.toBe(Professional.create(validProps()).id);
  });

  it.each([undefined, null, '', '   '])('stores the absent specialty %j as null', (specialty) => {
    expect(Professional.create(validProps({ specialty })).specialty).toBeNull();
  });

  it('rejects a professional without units', () => {
    expect(() => Professional.create(validProps({ unitIds: [] }))).toThrow(new DomainError('Professional must be linked to at least one unit'));
  });

  it('ignores a repeated unit', () => {
    expect(Professional.create(validProps({ unitIds: [unitA, unitA] })).unitIds).toEqual([unitA]);
  });

  it('rejects an empty name', () => {
    expect(() => Professional.create(validProps({ name: ' ' }))).toThrow(new DomainError('name is required'));
  });

  it('rejects an unknown category', () => {
    expect(() => Professional.create(validProps({ category: 'DENTIST' as ProfessionalCategory }))).toThrow(DomainError);
  });

  it('rejects a council incompatible with the category', () => {
    expect(() => Professional.create(validProps({ category: 'NURSE' }))).toThrow(
      new DomainError('registration.council must be COREN for category NURSE'),
    );
  });

  it('rejects a specialty longer than 100 characters', () => {
    expect(() => Professional.create(validProps({ specialty: 'a'.repeat(101) }))).toThrow(DomainError);
  });
});

describe('Professional.restore', () => {
  it('rebuilds the professional without revalidating', () => {
    const professional = Professional.restore(storedProps({ name: '', unitIds: [] }));

    expect(professional).toBeInstanceOf(Professional);
    expect(professional.name).toBe('');
    expect(professional.unitIds).toEqual([]);
  });

  it('does not share the unit list with the given props', () => {
    const props = storedProps();

    Professional.restore(props).linkUnit(unitB);

    expect(props.unitIds).toEqual([unitA]);
  });
});

describe('Professional.update', () => {
  it('changes name, specialty and registration', () => {
    const professional = Professional.restore(storedProps());

    professional.update({ name: 'Carlos Souza', specialty: 'UTI', registration: { council: 'COREN', number: '11111', state: 'PB' } });

    expect(professional.name).toBe('Carlos Souza');
    expect(professional.specialty).toBe('UTI');
    expect(professional.registration.formatted()).toBe('COREN 11111/PB');
  });

  it('revalidates the current registration when only the category changes', () => {
    const professional = Professional.restore(storedProps());

    professional.update({ category: 'TECHNICIAN' });
    expect(professional.category).toBe('TECHNICIAN');

    expect(() => professional.update({ category: 'PHYSICIAN' })).toThrow(DomainError);
    expect(professional.category).toBe('TECHNICIAN');
  });

  it('accepts a new category together with a compatible registration', () => {
    const professional = Professional.restore(storedProps());

    professional.update({ category: 'PHYSICIAN', registration: registrationInput() });

    expect(professional.category).toBe('PHYSICIAN');
    expect(professional.registration.council).toBe('CRM');
  });

  it('clears the specialty with null', () => {
    const professional = Professional.restore(storedProps({ specialty: 'UTI' }));

    professional.update({ specialty: null });

    expect(professional.specialty).toBeNull();
  });

  it('rejects an invalid change and keeps the professional unchanged', () => {
    const professional = Professional.restore(storedProps());

    expect(() => professional.update({ name: 'Outro', registration: { council: 'CRM', number: '1', state: 'PE' } })).toThrow(DomainError);
    expect(professional.name).toBe('Enf. Carlos Souza');
    expect(professional.registration.council).toBe('COREN');
  });
});

describe('Professional units', () => {
  it('links a new unit', () => {
    const professional = Professional.restore(storedProps());

    professional.linkUnit(unitB);

    expect(professional.unitIds).toEqual([unitA, unitB]);
    expect(professional.isLinkedTo(unitB)).toBe(true);
  });

  it('rejects linking a unit twice', () => {
    const professional = Professional.restore(storedProps());

    expect(() => professional.linkUnit(unitA)).toThrow(new DomainError('Professional is already linked to this unit'));
  });

  it('unlinks one of several units', () => {
    const professional = Professional.restore(storedProps({ unitIds: [unitA, unitB] }));

    professional.unlinkUnit(unitA);

    expect(professional.unitIds).toEqual([unitB]);
  });

  it('rejects unlinking the last unit', () => {
    const professional = Professional.restore(storedProps());

    expect(() => professional.unlinkUnit(unitA)).toThrow(new DomainError('Professional must be linked to at least one unit'));
    expect(professional.unitIds).toEqual([unitA]);
  });

  it('rejects unlinking a unit that is not linked', () => {
    const professional = Professional.restore(storedProps({ unitIds: [unitA, unitB] }));

    expect(() => professional.unlinkUnit('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toThrow(
      new DomainError('Professional is not linked to this unit'),
    );
  });

  it('does not expose its unit list for mutation', () => {
    const professional = Professional.restore(storedProps());

    professional.unitIds.push(unitB);

    expect(professional.unitIds).toEqual([unitA]);
  });
});

describe('Professional.canPrescribe', () => {
  it('is true for a PHYSICIAN', () => {
    expect(Professional.create(validProps()).canPrescribe()).toBe(true);
  });

  it.each(['NURSE', 'TECHNICIAN'] as const)('is false for a %s', (category) => {
    expect(Professional.restore(storedProps({ category })).canPrescribe()).toBe(false);
  });
});
