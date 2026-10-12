import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { Bed, type BedStatus, type CreateBedProps } from './bed.entity';

const now = new Date('2026-10-11T12:00:00.000Z');

function validProps(overrides: Partial<CreateBedProps> = {}): CreateBedProps {
  return {
    unitId: '11111111-1111-4111-8111-111111111111',
    identification: 'UTI-03',
    sector: 'UTI adulto',
    type: 'ICU',
    ...overrides,
  };
}

function bedIn(status: BedStatus): Bed {
  return Bed.restore({ ...validProps(), id: '22222222-2222-4222-8222-222222222222', status, createdAt: now });
}

describe('Bed.create', () => {
  it('generates a UUID id, trims the texts and starts AVAILABLE', () => {
    const bed = Bed.create(validProps({ identification: '  UTI-03 ', sector: ' UTI adulto ' }), now);

    expect(bed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bed.identification).toBe('UTI-03');
    expect(bed.sector).toBe('UTI adulto');
    expect(bed.type).toBe('ICU');
    expect(bed.status).toBe('AVAILABLE');
    expect(bed.createdAt).toEqual(now);
  });

  it.each(['', '   '])('rejects the empty identification %j', (identification) => {
    expect(() => Bed.create(validProps({ identification }))).toThrow(new DomainError('identification is required'));
  });

  it('rejects an identification longer than 20 characters', () => {
    expect(() => Bed.create(validProps({ identification: 'a'.repeat(21) }))).toThrow(
      new DomainError('identification must have at most 20 characters'),
    );
  });

  it('rejects the empty sector', () => {
    expect(() => Bed.create(validProps({ sector: ' ' }))).toThrow(new DomainError('sector is required'));
  });

  it('rejects a sector longer than 60 characters', () => {
    expect(() => Bed.create(validProps({ sector: 'a'.repeat(61) }))).toThrow(new DomainError('sector must have at most 60 characters'));
  });

  it('rejects an unknown type', () => {
    expect(() => Bed.create(validProps({ type: 'SUITE' as never }))).toThrow(new DomainError('type must be one of ICU, WARD'));
  });

  it('requires a unit', () => {
    expect(() => Bed.create(validProps({ unitId: '' }))).toThrow(new DomainError('unitId is required'));
  });
});

describe('Bed.update', () => {
  it('changes identification, sector and type', () => {
    const bed = bedIn('CLEANING');

    bed.update({ identification: 'ENF-10', sector: 'Clínica médica, 2º andar', type: 'WARD' });

    expect(bed.identification).toBe('ENF-10');
    expect(bed.sector).toBe('Clínica médica, 2º andar');
    expect(bed.type).toBe('WARD');
    expect(bed.status).toBe('CLEANING');
  });

  it('rejects any change on an OCCUPIED bed', () => {
    const bed = bedIn('OCCUPIED');

    expect(() => bed.update({ type: 'WARD' })).toThrow(DomainError);
    expect(bed.type).toBe('ICU');
  });

  it('keeps the bed unchanged when one of the fields is invalid', () => {
    const bed = bedIn('AVAILABLE');

    expect(() => bed.update({ identification: 'ENF-10', sector: '' })).toThrow(new DomainError('sector is required'));
    expect(bed.identification).toBe('UTI-03');
  });
});

describe('Bed.occupy', () => {
  it('moves an AVAILABLE bed to OCCUPIED', () => {
    const bed = bedIn('AVAILABLE');

    bed.occupy();

    expect(bed.status).toBe('OCCUPIED');
  });

  it.each(['OCCUPIED', 'CLEANING', 'MAINTENANCE'] as const)('rejects a %s bed', (status) => {
    const bed = bedIn(status);

    expect(() => bed.occupy()).toThrow(new DomainError(`Bed is ${status} and cannot be occupied`));
    expect(bed.status).toBe(status);
  });
});

describe('Bed.release', () => {
  it('moves an OCCUPIED bed to CLEANING', () => {
    const bed = bedIn('OCCUPIED');

    bed.release();

    expect(bed.status).toBe('CLEANING');
  });

  it.each(['AVAILABLE', 'CLEANING', 'MAINTENANCE'] as const)('rejects a %s bed', (status) => {
    const bed = bedIn(status);

    expect(() => bed.release()).toThrow(new DomainError(`Bed is ${status} and cannot be released`));
    expect(bed.status).toBe(status);
  });
});

describe('Bed.markAvailable and Bed.markMaintenance', () => {
  it.each(['AVAILABLE', 'CLEANING', 'MAINTENANCE'] as const)('mark a %s bed as AVAILABLE or MAINTENANCE', (status) => {
    const toAvailable = bedIn(status);
    const toMaintenance = bedIn(status);

    toAvailable.markAvailable();
    toMaintenance.markMaintenance();

    expect(toAvailable.status).toBe('AVAILABLE');
    expect(toMaintenance.status).toBe('MAINTENANCE');
  });

  it('reject an OCCUPIED bed', () => {
    const bed = bedIn('OCCUPIED');

    expect(() => bed.markAvailable()).toThrow(DomainError);
    expect(() => bed.markMaintenance()).toThrow(DomainError);
    expect(bed.status).toBe('OCCUPIED');
  });
});

describe('Bed.changeStatus', () => {
  it('applies a manual status', () => {
    const bed = bedIn('CLEANING');

    bed.changeStatus('AVAILABLE');

    expect(bed.status).toBe('AVAILABLE');
  });

  it.each(['OCCUPIED', 'CLEANING'])('rejects the status %s, which only comes from an admission', (status) => {
    const bed = bedIn('AVAILABLE');

    expect(() => bed.changeStatus(status as never)).toThrow(new DomainError('status must be one of AVAILABLE, MAINTENANCE'));
    expect(bed.status).toBe('AVAILABLE');
  });
});
