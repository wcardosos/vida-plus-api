import { describe, expect, it } from 'vitest';
import { Appointment, type AppointmentStatus } from '../entities/appointment.entity';
import { ScheduleAvailability, type CreateScheduleAvailabilityProps } from '../entities/schedule-availability.entity';
import { ScheduleBlock } from '../entities/schedule-block.entity';
import { candidateSlots, freeSlots, type FreeSlotsInput } from './free-slots';

const timeZone = 'America/Fortaleza';
const professionalId = '11111111-1111-4111-8111-111111111111';
const unitId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date('2026-10-11T12:00:00.000Z');
const mondayStart = new Date('2026-10-12T03:00:00.000Z');
const tuesdayStart = new Date('2026-10-13T03:00:00.000Z');

function local(time: string, date = '2026-10-12') {
  return new Date(`${date}T${time}:00-03:00`);
}

function availability(overrides: Partial<CreateScheduleAvailabilityProps> = {}) {
  return ScheduleAvailability.create({
    professionalId,
    unitId,
    weekday: 1,
    startTime: '08:00',
    endTime: '10:00',
    slotMinutes: 30,
    modality: 'IN_PERSON',
    ...overrides,
  });
}

function appointment(start: string, end: string, status: AppointmentStatus = 'SCHEDULED') {
  return Appointment.restore({
    id: '22222222-2222-4222-8222-222222222222',
    patientId: '33333333-3333-4333-8333-333333333333',
    professionalId,
    unitId,
    modality: 'IN_PERSON',
    startsAt: local(start),
    endsAt: local(end),
    status,
    cancellationReason: status === 'CANCELED' ? 'Imprevisto' : null,
    canceledBy: status === 'CANCELED' ? 'PATIENT' : null,
    canceledAt: null,
    createdAt: now,
  });
}

function block(start: string, end: string) {
  return ScheduleBlock.create({ professionalId, startsAt: local(start), endsAt: local(end), reason: 'Reunião' });
}

function input(overrides: Partial<FreeSlotsInput> = {}): FreeSlotsInput {
  return {
    availabilities: [availability()],
    blocks: [],
    appointments: [],
    from: mondayStart,
    to: tuesdayStart,
    now,
    timeZone,
    ...overrides,
  };
}

function localStarts(slots: { startsAt: Date }[]) {
  return slots.map((slot) => new Date(slot.startsAt.getTime() - 3 * 3_600_000).toISOString().slice(11, 16));
}

describe('freeSlots', () => {
  it('returns every slot of the day when nothing is taken', () => {
    expect(localStarts(freeSlots(input()))).toEqual(['08:00', '08:30', '09:00', '09:30']);
  });

  it('returns the slots with end, unit and modality in UTC', () => {
    expect(freeSlots(input())[0]).toEqual({
      startsAt: new Date('2026-10-12T11:00:00.000Z'),
      endsAt: new Date('2026-10-12T11:30:00.000Z'),
      unitId,
      modality: 'IN_PERSON',
    });
  });

  it('removes the slot of a scheduled appointment', () => {
    expect(localStarts(freeSlots(input({ appointments: [appointment('08:30', '09:00')] })))).toEqual(['08:00', '09:00', '09:30']);
  });

  it('removes every slot crossed by an appointment of an older availability', () => {
    const slots = freeSlots(input({ availabilities: [availability({ slotMinutes: 40 })], appointments: [appointment('08:30', '09:00')] }));

    expect(localStarts(slots)).toEqual(['09:20']);
  });

  it('ignores canceled appointments', () => {
    expect(localStarts(freeSlots(input({ appointments: [appointment('08:30', '09:00', 'CANCELED')] })))).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
    ]);
  });

  it.each(['COMPLETED', 'NO_SHOW'] as const)('keeps a %s appointment taking its slot', (status) => {
    expect(localStarts(freeSlots(input({ appointments: [appointment('08:30', '09:00', status)] })))).toEqual(['08:00', '09:00', '09:30']);
  });

  it('removes slots partially covered by a block', () => {
    expect(localStarts(freeSlots(input({ blocks: [block('08:45', '09:10')] })))).toEqual(['08:00', '09:30']);
  });

  it('keeps slots adjacent to a block', () => {
    expect(localStarts(freeSlots(input({ blocks: [block('08:30', '09:00')] })))).toEqual(['08:00', '09:00', '09:30']);
  });

  it('removes slots that start at or before now', () => {
    expect(localStarts(freeSlots(input({ now: local('08:30') })))).toEqual(['09:00', '09:30']);
  });

  it('removes slots more than 90 days ahead', () => {
    const lastAllowed = new Date(local('08:30').getTime() - 90 * 86_400_000);

    expect(localStarts(freeSlots(input({ now: lastAllowed })))).toEqual(['08:00', '08:30']);
  });

  it('spans several days in chronological order, mixing availabilities', () => {
    const slots = freeSlots(
      input({
        availabilities: [
          availability({ weekday: 2, startTime: '14:00', endTime: '15:00', slotMinutes: 60, modality: 'TELECONSULTATION' }),
          availability({ startTime: '09:00', endTime: '10:00', slotMinutes: 60 }),
        ],
        to: new Date('2026-10-14T03:00:00.000Z'),
      }),
    );

    expect(slots.map((slot) => [slot.startsAt.toISOString(), slot.modality])).toEqual([
      ['2026-10-12T12:00:00.000Z', 'IN_PERSON'],
      ['2026-10-13T17:00:00.000Z', 'TELECONSULTATION'],
    ]);
  });

  it('only returns slots that fit entirely in the period', () => {
    expect(localStarts(freeSlots(input({ from: local('08:10'), to: local('09:30') })))).toEqual(['08:30', '09:00']);
  });
});

describe('candidateSlots', () => {
  it('ignores appointments and now, but not blocks', () => {
    const slots = candidateSlots({ availabilities: [availability()], blocks: [block('09:00', '10:00')], from: mondayStart, to: tuesdayStart, timeZone });

    expect(localStarts(slots)).toEqual(['08:00', '08:30']);
  });
});
