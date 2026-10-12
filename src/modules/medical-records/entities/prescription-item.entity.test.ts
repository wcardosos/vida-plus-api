import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { PrescriptionItem, type PrescriptionItemInput } from './prescription-item.entity';

function input(overrides: Partial<PrescriptionItemInput> = {}): PrescriptionItemInput {
  return {
    medication: ' Salbutamol 100 mcg ',
    dose: '2 jatos',
    dosageInstructions: 'de 6 em 6 horas se falta de ar',
    duration: '15 dias',
    ...overrides,
  };
}

describe('PrescriptionItem.create', () => {
  it('creates the item with a generated id, the position and trimmed fields', () => {
    const item = PrescriptionItem.create(input(), 1);

    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.position).toBe(1);
    expect(item.medication).toBe('Salbutamol 100 mcg');
  });

  it.each(['medication', 'dose', 'dosageInstructions', 'duration'] as const)('requires %s', (field) => {
    expect(() => PrescriptionItem.create(input({ [field]: ' ' }), 3)).toThrow(new DomainError(`items[2].${field} is required`));
  });

  it.each([
    ['medication', PrescriptionItem.medicationMaxLength],
    ['dose', PrescriptionItem.doseMaxLength],
    ['dosageInstructions', PrescriptionItem.dosageInstructionsMaxLength],
    ['duration', PrescriptionItem.durationMaxLength],
  ] as const)('limits %s to %i characters', (field, max) => {
    expect(() => PrescriptionItem.create(input({ [field]: 'a'.repeat(max + 1) }), 1)).toThrow(
      new DomainError(`items[0].${field} must have at most ${max} characters`),
    );
  });

  it.each([0, -1, 1.5])('rejects the position %d', (position) => {
    expect(() => PrescriptionItem.create(input(), position)).toThrow(new DomainError('position must be a positive integer'));
  });
});
