import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import {
  ScheduleAvailability,
  TimeOfDay,
  type CreateScheduleAvailabilityProps,
  type ScheduleAvailabilityProps,
} from './schedule-availability.entity';

const timeZone = 'America/Fortaleza';
const now = new Date('2026-10-11T12:00:00.000Z');
const professionalId = '11111111-1111-4111-8111-111111111111';
const unitId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const monday = '2026-10-12';

function validProps(overrides: Partial<CreateScheduleAvailabilityProps> = {}): CreateScheduleAvailabilityProps {
  return { professionalId, unitId, weekday: 1, startTime: '08:00', endTime: '10:00', slotMinutes: 30, modality: 'IN_PERSON', ...overrides };
}

function storedProps(overrides: Partial<ScheduleAvailabilityProps> = {}): ScheduleAvailabilityProps {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    professionalId,
    unitId,
    weekday: 1,
    startTime: TimeOfDay.create('08:00'),
    endTime: TimeOfDay.create('12:00'),
    slotMinutes: 30,
    modality: 'IN_PERSON',
    createdAt: now,
    ...overrides,
  };
}

function startTimes(availability: ScheduleAvailability, date: string) {
  return availability.generateSlots(date, timeZone).map((slot) => slot.startsAt.toISOString());
}

describe('TimeOfDay', () => {
  it.each([
    ['00:00', 0],
    ['23:59', 1439],
    ['08:30', 510],
  ])('accepts %s', (raw, minutes) => {
    expect(TimeOfDay.create(raw).minutes).toBe(minutes);
  });

  it.each(['24:00', '12:60', '99:00'])('rejects %s', (raw) => {
    expect(() => TimeOfDay.create(raw)).toThrow(new DomainError('time must be between 00:00 and 23:59'));
  });

  it.each(['8:00', '08h00', '', '08:00:00'])('rejects the malformed value %j', (raw) => {
    expect(() => TimeOfDay.create(raw)).toThrow(new DomainError('time must be formatted as HH:MM'));
  });

  it('adds minutes', () => {
    expect(TimeOfDay.create('08:40').plusMinutes(40).toString()).toBe('09:20');
  });

  it('rejects a sum past the end of the day', () => {
    expect(() => TimeOfDay.create('23:30').plusMinutes(30)).toThrow(DomainError);
  });

  it('compares and formats', () => {
    const eight = TimeOfDay.create('08:00');
    const nine = TimeOfDay.create('09:05');

    expect(eight.isBefore(nine)).toBe(true);
    expect(nine.isBefore(eight)).toBe(false);
    expect(eight.equals(TimeOfDay.fromMinutes(480))).toBe(true);
    expect(eight.minutesUntil(nine)).toBe(65);
    expect(nine.toString()).toBe('09:05');
  });
});

describe('ScheduleAvailability.create', () => {
  it('generates a UUID id and keeps the given data', () => {
    const availability = ScheduleAvailability.create(validProps(), now);

    expect(availability.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(availability.professionalId).toBe(professionalId);
    expect(availability.unitId).toBe(unitId);
    expect(availability.weekday).toBe(1);
    expect(availability.startTime.toString()).toBe('08:00');
    expect(availability.endTime.toString()).toBe('10:00');
    expect(availability.slotMinutes).toBe(30);
    expect(availability.modality).toBe('IN_PERSON');
    expect(availability.createdAt).toEqual(now);
  });

  it.each([
    ['12:00', '08:00'],
    ['08:00', '08:00'],
  ])('rejects the range %s to %s', (startTime, endTime) => {
    expect(() => ScheduleAvailability.create(validProps({ startTime, endTime }))).toThrow(new DomainError('endTime must be after startTime'));
  });

  it.each([0, 4, 241, 30.5])('rejects %d slot minutes', (slotMinutes) => {
    expect(() => ScheduleAvailability.create(validProps({ startTime: '00:00', endTime: '23:59', slotMinutes }))).toThrow(
      new DomainError('slotMinutes must be between 5 and 240'),
    );
  });

  it('accepts 5 and 240 slot minutes', () => {
    expect(ScheduleAvailability.create(validProps({ endTime: '12:00', slotMinutes: 240 })).slotMinutes).toBe(240);
    expect(ScheduleAvailability.create(validProps({ slotMinutes: 5 })).slotMinutes).toBe(5);
  });

  it('rejects a slot longer than the range', () => {
    expect(() => ScheduleAvailability.create(validProps({ endTime: '08:20', slotMinutes: 30 }))).toThrow(
      new DomainError('slotMinutes must fit between startTime and endTime'),
    );
  });

  it.each([0, 8, 1.5])('rejects the weekday %d', (weekday) => {
    expect(() => ScheduleAvailability.create(validProps({ weekday }))).toThrow(
      new DomainError('weekday must be between 1 (Monday) and 7 (Sunday)'),
    );
  });

  it('rejects an unknown modality', () => {
    expect(() => ScheduleAvailability.create(validProps({ modality: 'HOME' as 'IN_PERSON' }))).toThrow(DomainError);
  });

  it.each(['professionalId', 'unitId'] as const)('requires %s', (field) => {
    expect(() => ScheduleAvailability.create(validProps({ [field]: '' }))).toThrow(new DomainError(`${field} is required`));
  });
});

describe('ScheduleAvailability.restore', () => {
  it('rebuilds without revalidating', () => {
    const availability = ScheduleAvailability.restore(storedProps({ slotMinutes: 1 }));

    expect(availability.slotMinutes).toBe(1);
  });
});

describe('ScheduleAvailability.update', () => {
  it('changes the given fields and keeps the others', () => {
    const availability = ScheduleAvailability.restore(storedProps());

    availability.update({ endTime: '11:00', slotMinutes: 20, modality: 'TELECONSULTATION' });

    expect(availability.startTime.toString()).toBe('08:00');
    expect(availability.endTime.toString()).toBe('11:00');
    expect(availability.slotMinutes).toBe(20);
    expect(availability.modality).toBe('TELECONSULTATION');
  });

  it('rejects an invalid change and keeps the availability unchanged', () => {
    const availability = ScheduleAvailability.restore(storedProps());

    expect(() => availability.update({ weekday: 2, endTime: '07:00' })).toThrow(DomainError);
    expect(availability.weekday).toBe(1);
    expect(availability.endTime.toString()).toBe('12:00');
  });

  it('validates the new slot against the current range', () => {
    const availability = ScheduleAvailability.restore(storedProps({ endTime: TimeOfDay.create('09:00') }));

    expect(() => availability.update({ slotMinutes: 90 })).toThrow(new DomainError('slotMinutes must fit between startTime and endTime'));
  });
});

describe('ScheduleAvailability.overlaps', () => {
  const morning = ScheduleAvailability.create(validProps({ startTime: '08:00', endTime: '12:00' }));

  it('is true for crossing ranges on the same weekday, in any unit or modality', () => {
    const other = ScheduleAvailability.create(
      validProps({ unitId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', modality: 'TELECONSULTATION', startTime: '11:00', endTime: '14:00' }),
    );

    expect(morning.overlaps(other)).toBe(true);
    expect(other.overlaps(morning)).toBe(true);
  });

  it('is true for a range inside another', () => {
    expect(morning.overlaps(ScheduleAvailability.create(validProps({ startTime: '09:00', endTime: '10:00' })))).toBe(true);
  });

  it('is false for adjacent ranges', () => {
    const afternoon = ScheduleAvailability.create(validProps({ startTime: '12:00', endTime: '14:00' }));

    expect(morning.overlaps(afternoon)).toBe(false);
    expect(afternoon.overlaps(morning)).toBe(false);
  });

  it('is false on different weekdays', () => {
    expect(morning.overlaps(ScheduleAvailability.create(validProps({ weekday: 2, startTime: '08:00', endTime: '12:00' })))).toBe(false);
  });
});

describe('ScheduleAvailability.generateSlots', () => {
  it('splits 08:00-10:00 into four 30-minute slots, converted from Fortaleza time to UTC', () => {
    const availability = ScheduleAvailability.create(validProps());

    const slots = availability.generateSlots(monday, timeZone);

    expect(slots.map((slot) => [slot.startsAt.toISOString(), slot.endsAt.toISOString()])).toEqual([
      ['2026-10-12T11:00:00.000Z', '2026-10-12T11:30:00.000Z'],
      ['2026-10-12T11:30:00.000Z', '2026-10-12T12:00:00.000Z'],
      ['2026-10-12T12:00:00.000Z', '2026-10-12T12:30:00.000Z'],
      ['2026-10-12T12:30:00.000Z', '2026-10-12T13:00:00.000Z'],
    ]);
    expect(slots.every((slot) => slot.unitId === unitId && slot.modality === 'IN_PERSON')).toBe(true);
  });

  it('discards the leftover that does not fit a 40-minute slot', () => {
    const availability = ScheduleAvailability.create(validProps({ slotMinutes: 40 }));

    expect(startTimes(availability, monday)).toEqual(['2026-10-12T11:00:00.000Z', '2026-10-12T11:40:00.000Z', '2026-10-12T12:20:00.000Z']);
  });

  it('generates nothing on another weekday', () => {
    expect(ScheduleAvailability.create(validProps()).generateSlots('2026-10-13', timeZone)).toEqual([]);
  });

  it('uses the given time zone', () => {
    const availability = ScheduleAvailability.create(validProps({ startTime: '08:00', endTime: '08:30' }));

    expect(startTimes(availability, monday)).toEqual(['2026-10-12T11:00:00.000Z']);
    expect(availability.generateSlots(monday, 'UTC')[0].startsAt.toISOString()).toBe('2026-10-12T08:00:00.000Z');
  });
});
