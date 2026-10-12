import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { AdmissionMovement } from './admission-movement.entity';
import { Admission } from './admission.entity';
import { Bed, type BedStatus } from './bed.entity';

const now = new Date('2026-10-11T12:00:00.000Z');
const later = new Date('2026-10-12T09:30:00.000Z');

const unitId = '11111111-1111-4111-8111-111111111111';
const patientId = '33333333-3333-4333-8333-333333333333';
const professionalId = '44444444-4444-4444-8444-444444444444';

let bedCounter = 0;

function bed(status: BedStatus = 'AVAILABLE', unit = unitId): Bed {
  bedCounter += 1;
  return Bed.restore({
    id: `00000000-0000-4000-8000-${String(bedCounter).padStart(12, '0')}`,
    unitId: unit,
    identification: `LEITO-${bedCounter}`,
    sector: 'Clínica médica',
    type: 'WARD',
    status,
    createdAt: now,
  });
}

function admitted() {
  const current = bed();
  const admission = Admission.admit({ patientId, responsibleProfessionalId: professionalId, bed: current }, now);
  return { admission, current };
}

describe('Admission.admit', () => {
  it('occupies the bed, starts ACTIVE and records an ADMISSION movement without origin', () => {
    const target = bed();

    const admission = Admission.admit({ patientId, responsibleProfessionalId: professionalId, bed: target }, now);

    expect(admission.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(target.status).toBe('OCCUPIED');
    expect(admission).toMatchObject({
      patientId,
      unitId,
      currentBedId: target.id,
      responsibleProfessionalId: professionalId,
      status: 'ACTIVE',
      admittedAt: now,
      dischargedAt: null,
    });
    const movements = admission.getMovements();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ admissionId: admission.id, type: 'ADMISSION', fromBedId: null, toBedId: target.id, occurredAt: now });
  });

  it.each(['OCCUPIED', 'CLEANING', 'MAINTENANCE'] as const)('rejects a %s bed', (status) => {
    const target = bed(status);

    expect(() => Admission.admit({ patientId, responsibleProfessionalId: professionalId, bed: target }, now)).toThrow(
      new DomainError(`Bed is ${status} and cannot be occupied`),
    );
    expect(target.status).toBe(status);
  });

  it.each(['patientId', 'responsibleProfessionalId'] as const)('requires %s', (field) => {
    const target = bed();

    expect(() => Admission.admit({ patientId, responsibleProfessionalId: professionalId, bed: target, [field]: '' }, now)).toThrow(
      new DomainError(`${field} is required`),
    );
    expect(target.status).toBe('AVAILABLE');
  });
});

describe('Admission.transfer', () => {
  it('releases the origin, occupies the destination, moves the current bed and records a TRANSFER movement', () => {
    const { admission, current } = admitted();
    const destination = bed();

    admission.transfer(current, destination, later);

    expect(current.status).toBe('CLEANING');
    expect(destination.status).toBe('OCCUPIED');
    expect(admission.currentBedId).toBe(destination.id);
    expect(admission.status).toBe('ACTIVE');
    const movements = admission.getMovements();
    expect(movements.map((movement) => movement.type)).toEqual(['ADMISSION', 'TRANSFER']);
    expect(movements[1]).toMatchObject({ type: 'TRANSFER', fromBedId: current.id, toBedId: destination.id, occurredAt: later });
  });

  it('rejects the current bed as destination', () => {
    const { admission, current } = admitted();

    expect(() => admission.transfer(current, current, later)).toThrow(new DomainError('Patient is already in this bed'));
    expect(current.status).toBe('OCCUPIED');
  });

  it('rejects a bed of another unit', () => {
    const { admission, current } = admitted();
    const elsewhere = bed('AVAILABLE', '55555555-5555-4555-8555-555555555555');

    expect(() => admission.transfer(current, elsewhere, later)).toThrow(DomainError);
    expect(elsewhere.status).toBe('AVAILABLE');
    expect(current.status).toBe('OCCUPIED');
  });

  it('rejects a DISCHARGED admission', () => {
    const { admission, current } = admitted();
    admission.discharge(current, later);
    const destination = bed();

    expect(() => admission.transfer(current, destination, later)).toThrow(new DomainError('Admission is DISCHARGED and cannot be changed'));
    expect(destination.status).toBe('AVAILABLE');
  });

  it('rejects an origin that is not the current bed', () => {
    const { admission } = admitted();
    const other = bed('OCCUPIED');

    expect(() => admission.transfer(other, bed(), later)).toThrow(new DomainError('Bed is not the current bed of the admission'));
  });

  it('leaves no partial state when the destination cannot be occupied', () => {
    const { admission, current } = admitted();
    const destination = bed('CLEANING');

    expect(() => admission.transfer(current, destination, later)).toThrow(new DomainError('Bed is CLEANING and cannot be occupied'));
    expect(current.status).toBe('OCCUPIED');
    expect(destination.status).toBe('CLEANING');
    expect(admission.currentBedId).toBe(current.id);
    expect(admission.getMovements()).toHaveLength(1);
  });
});

describe('Admission.discharge', () => {
  it('releases the bed, becomes DISCHARGED with the date and records a DISCHARGE movement without destination', () => {
    const { admission, current } = admitted();

    admission.discharge(current, later);

    expect(current.status).toBe('CLEANING');
    expect(admission.status).toBe('DISCHARGED');
    expect(admission.dischargedAt).toEqual(later);
    expect(admission.currentBedId).toBe(current.id);
    expect(admission.getMovements()[1]).toMatchObject({ type: 'DISCHARGE', fromBedId: current.id, toBedId: null, occurredAt: later });
  });

  it('rejects a second discharge', () => {
    const { admission, current } = admitted();
    admission.discharge(current, later);

    expect(() => admission.discharge(current, later)).toThrow(new DomainError('Admission is DISCHARGED and cannot be changed'));
    expect(admission.getMovements()).toHaveLength(2);
  });

  it('rejects a bed that is not the current one', () => {
    const { admission, current } = admitted();

    expect(() => admission.discharge(bed('OCCUPIED'), later)).toThrow(new DomainError('Bed is not the current bed of the admission'));
    expect(current.status).toBe('OCCUPIED');
    expect(admission.isActive()).toBe(true);
  });
});

describe('Admission.getMovements', () => {
  it('returns a list that callers cannot use to change the admission', () => {
    const { admission, current } = admitted();

    const movements = admission.getMovements();
    movements.push(AdmissionMovement.record({ admissionId: admission.id, type: 'DISCHARGE', fromBedId: current.id }, later));
    movements.length = 0;

    expect(admission.getMovements()).toHaveLength(1);
  });
});

describe('Admission.restore', () => {
  it('orders the movements chronologically', () => {
    const first = bed('CLEANING');
    const second = bed('OCCUPIED');
    const id = '66666666-6666-4666-8666-666666666666';
    const transfer = AdmissionMovement.restore({ id: 'b', admissionId: id, type: 'TRANSFER', fromBedId: first.id, toBedId: second.id, occurredAt: later });
    const admission = AdmissionMovement.restore({ id: 'a', admissionId: id, type: 'ADMISSION', fromBedId: null, toBedId: first.id, occurredAt: now });

    const restored = Admission.restore({
      id,
      patientId,
      unitId,
      currentBedId: second.id,
      responsibleProfessionalId: professionalId,
      status: 'ACTIVE',
      admittedAt: now,
      dischargedAt: null,
      movements: [transfer, admission],
    });

    expect(restored.getMovements().map((movement) => movement.type)).toEqual(['ADMISSION', 'TRANSFER']);
  });
});

describe('Admission.ensureAcceptsMedicalRecord', () => {
  it('accepts an ACTIVE admission and rejects a DISCHARGED one', () => {
    const { admission, current } = admitted();

    expect(() => admission.ensureAcceptsMedicalRecord()).not.toThrow();
    admission.discharge(current, later);
    expect(() => admission.ensureAcceptsMedicalRecord()).toThrow(new DomainError('Admission is DISCHARGED and does not accept medical records'));
  });
});

describe('AdmissionMovement.record', () => {
  const admissionId = '66666666-6666-4666-8666-666666666666';
  const a = '77777777-7777-4777-8777-777777777777';
  const b = '88888888-8888-4888-8888-888888888888';

  it.each([
    ['ADMISSION', a, b],
    ['ADMISSION', null, null],
    ['DISCHARGE', null, a],
    ['DISCHARGE', a, b],
    ['TRANSFER', a, null],
    ['TRANSFER', null, b],
    ['TRANSFER', a, a],
  ] as const)('rejects a %s from %s to %s', (type, fromBedId, toBedId) => {
    expect(() => AdmissionMovement.record({ admissionId, type, fromBedId, toBedId }, now)).toThrow(DomainError);
  });

  it('rejects an unknown type', () => {
    expect(() => AdmissionMovement.record({ admissionId, type: 'SWAP' as never, fromBedId: a, toBedId: b }, now)).toThrow(
      new DomainError('type must be one of ADMISSION, TRANSFER, DISCHARGE'),
    );
  });
});
