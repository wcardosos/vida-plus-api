import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { Appointment, type AppointmentProps, type AppointmentStatus, type ScheduleAppointmentProps } from './appointment.entity';

const now = new Date('2026-10-11T12:00:00.000Z');
const dayMs = 86_400_000;

function validProps(overrides: Partial<ScheduleAppointmentProps> = {}): ScheduleAppointmentProps {
  return {
    patientId: '11111111-1111-4111-8111-111111111111',
    professionalId: '22222222-2222-4222-8222-222222222222',
    unitId: '33333333-3333-4333-8333-333333333333',
    modality: 'IN_PERSON',
    startsAt: new Date('2026-10-12T12:00:00.000Z'),
    endsAt: new Date('2026-10-12T12:30:00.000Z'),
    ...overrides,
  };
}

function storedProps(overrides: Partial<AppointmentProps> = {}): AppointmentProps {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    ...validProps(),
    status: 'SCHEDULED',
    cancellationReason: null,
    canceledBy: null,
    canceledAt: null,
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
}

const finalStatuses: AppointmentStatus[] = ['CANCELED', 'COMPLETED', 'NO_SHOW'];

const beforeStart = new Date('2026-10-12T11:59:00.000Z');
const afterStart = new Date('2026-10-12T12:05:00.000Z');

describe('Appointment.schedule', () => {
  it('starts SCHEDULED with a generated id', () => {
    const appointment = Appointment.schedule(validProps(), now);

    expect(appointment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(appointment.status).toBe('SCHEDULED');
    expect(appointment.startsAt).toEqual(validProps().startsAt);
    expect(appointment.endsAt).toEqual(validProps().endsAt);
    expect(appointment.cancellationReason).toBeNull();
    expect(appointment.canceledBy).toBeNull();
    expect(appointment.createdAt).toEqual(now);
  });

  it.each([
    ['in the past', new Date('2026-10-11T11:00:00.000Z')],
    ['now', now],
  ])('rejects a start %s', (_, startsAt) => {
    expect(() => Appointment.schedule(validProps({ startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000) }), now)).toThrow(
      new DomainError('startsAt must be in the future'),
    );
  });

  it('accepts exactly 90 days ahead and rejects 91', () => {
    const in90Days = new Date(now.getTime() + 90 * dayMs);
    const in91Days = new Date(now.getTime() + 91 * dayMs);

    expect(Appointment.schedule(validProps({ startsAt: in90Days, endsAt: new Date(in90Days.getTime() + 1_800_000) }), now).status).toBe(
      'SCHEDULED',
    );
    expect(() => Appointment.schedule(validProps({ startsAt: in91Days, endsAt: new Date(in91Days.getTime() + 1_800_000) }), now)).toThrow(
      new DomainError('startsAt must be at most 90 days ahead'),
    );
  });

  it('rejects an end that is not after the start', () => {
    expect(() => Appointment.schedule(validProps({ endsAt: validProps().startsAt }), now)).toThrow(new DomainError('endsAt must be after startsAt'));
  });

  it.each(['patientId', 'professionalId', 'unitId'] as const)('requires %s', (field) => {
    expect(() => Appointment.schedule(validProps({ [field]: '' }), now)).toThrow(new DomainError(`${field} is required`));
  });

  it('rejects an unknown modality', () => {
    expect(() => Appointment.schedule(validProps({ modality: 'HOME' as 'IN_PERSON' }), now)).toThrow(DomainError);
  });
});

describe('Appointment.restore', () => {
  it('rebuilds a past appointment without revalidating', () => {
    const appointment = Appointment.restore(storedProps({ startsAt: new Date('2020-01-01T12:00:00.000Z') }));

    expect(appointment.startsAt).toEqual(new Date('2020-01-01T12:00:00.000Z'));
  });
});

describe('Appointment.isTeleconsultation', () => {
  it('reflects the modality', () => {
    expect(Appointment.schedule(validProps({ modality: 'TELECONSULTATION' }), now).isTeleconsultation()).toBe(true);
    expect(Appointment.schedule(validProps(), now).isTeleconsultation()).toBe(false);
  });
});

describe('Appointment.cancel', () => {
  it('records the trimmed reason, who canceled and when', () => {
    const appointment = Appointment.restore(storedProps());

    appointment.cancel('  Imprevisto  ', 'PATIENT', beforeStart);

    expect(appointment.status).toBe('CANCELED');
    expect(appointment.cancellationReason).toBe('Imprevisto');
    expect(appointment.canceledBy).toBe('PATIENT');
    expect(appointment.canceledAt).toEqual(beforeStart);
  });

  it('records a cancellation by the professional', () => {
    const appointment = Appointment.restore(storedProps());

    appointment.cancel('Férias', 'PROFESSIONAL', beforeStart);

    expect(appointment.canceledBy).toBe('PROFESSIONAL');
  });

  it.each(['', '   '])('rejects the empty reason %j', (reason) => {
    const appointment = Appointment.restore(storedProps());

    expect(() => appointment.cancel(reason, 'PATIENT', beforeStart)).toThrow(new DomainError('cancellationReason is required'));
    expect(appointment.status).toBe('SCHEDULED');
  });

  it('rejects a reason longer than 200 characters', () => {
    expect(() => Appointment.restore(storedProps()).cancel('a'.repeat(201), 'PATIENT', beforeStart)).toThrow(DomainError);
  });

  it.each(finalStatuses)('rejects canceling a %s appointment', (status) => {
    const appointment = Appointment.restore(storedProps({ status, cancellationReason: status === 'CANCELED' ? 'x' : null }));

    expect(() => appointment.cancel('Imprevisto', 'PATIENT', beforeStart)).toThrow(new DomainError(`Appointment is ${status} and cannot be changed`));
    expect(appointment.status).toBe(status);
  });

  it.each([
    ['at', new Date('2026-10-12T12:00:00.000Z')],
    ['after', afterStart],
  ])('rejects canceling %s the start', (_, at) => {
    const appointment = Appointment.restore(storedProps());

    expect(() => appointment.cancel('Imprevisto', 'PATIENT', at)).toThrow(
      new DomainError('Appointment has already started and can no longer be canceled'),
    );
    expect(appointment.status).toBe('SCHEDULED');
  });
});

describe('Appointment.markNoShow', () => {
  it('turns a started SCHEDULED appointment into NO_SHOW', () => {
    const appointment = Appointment.restore(storedProps());

    appointment.markNoShow(afterStart);

    expect(appointment.status).toBe('NO_SHOW');
  });

  it('rejects marking before the start', () => {
    const appointment = Appointment.restore(storedProps());

    expect(() => appointment.markNoShow(beforeStart)).toThrow(new DomainError('A no-show can only be marked after the appointment starts'));
    expect(appointment.status).toBe('SCHEDULED');
  });

  it.each(finalStatuses)('rejects marking a %s appointment', (status) => {
    expect(() => Appointment.restore(storedProps({ status })).markNoShow(afterStart)).toThrow(DomainError);
  });
});

describe('Appointment.complete', () => {
  it('completes a SCHEDULED appointment', () => {
    const appointment = Appointment.restore(storedProps());

    appointment.complete();

    expect(appointment.status).toBe('COMPLETED');
  });

  it.each(finalStatuses)('rejects completing a %s appointment', (status) => {
    expect(() => Appointment.restore(storedProps({ status })).complete()).toThrow(DomainError);
  });
});

describe('Appointment.ensureAcceptsMedicalRecord', () => {
  const startsAt = validProps().startsAt;
  const minutesFromStart = (minutes: number) => new Date(startsAt.getTime() + minutes * 60_000);

  it.each(['SCHEDULED', 'COMPLETED'] as const)('accepts a %s appointment that has started', (status) => {
    expect(() => Appointment.restore(storedProps({ status })).ensureAcceptsMedicalRecord(minutesFromStart(5))).not.toThrow();
  });

  it('accepts an appointment that starts in exactly 15 minutes', () => {
    expect(() => Appointment.restore(storedProps()).ensureAcceptsMedicalRecord(minutesFromStart(-15))).not.toThrow();
  });

  it('rejects an appointment that starts in more than 15 minutes', () => {
    expect(() => Appointment.restore(storedProps()).ensureAcceptsMedicalRecord(minutesFromStart(-16))).toThrow(
      new DomainError('Medical records are accepted from 15 minutes before the appointment starts'),
    );
  });

  it.each(['CANCELED', 'NO_SHOW'] as const)('rejects a %s appointment', (status) => {
    const appointment = Appointment.restore(storedProps({ status, cancellationReason: status === 'CANCELED' ? 'x' : null }));

    expect(() => appointment.ensureAcceptsMedicalRecord(minutesFromStart(5))).toThrow(
      new DomainError(`Appointment is ${status} and does not accept medical records`),
    );
  });
});

describe('Appointment.completesOnMedicalRecord', () => {
  it('is true only for a SCHEDULED in-person appointment', () => {
    expect(Appointment.restore(storedProps()).completesOnMedicalRecord()).toBe(true);
    expect(Appointment.restore(storedProps({ modality: 'TELECONSULTATION' })).completesOnMedicalRecord()).toBe(false);
    expect(Appointment.restore(storedProps({ status: 'COMPLETED' })).completesOnMedicalRecord()).toBe(false);
  });
});

describe('Appointment.overlaps', () => {
  const at = (time: string) => new Date(`2026-10-12T${time}:00.000Z`);

  it('is true for crossing intervals and false for adjacent ones', () => {
    const appointment = Appointment.restore(storedProps());

    expect(appointment.overlaps(at('12:20'), at('12:50'))).toBe(true);
    expect(appointment.overlaps(at('11:40'), at('12:10'))).toBe(true);
    expect(appointment.overlaps(at('12:30'), at('13:00'))).toBe(false);
    expect(appointment.overlaps(at('11:30'), at('12:00'))).toBe(false);
  });

  it('is false for a canceled appointment', () => {
    const appointment = Appointment.restore(storedProps({ status: 'CANCELED', cancellationReason: 'x' }));

    expect(appointment.overlaps(at('12:00'), at('12:30'))).toBe(false);
  });
});
