import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { isoWeekday, zonedTimeToInstant } from '../../../shared/time-zone';
import { modalities, type Modality } from './appointment.entity';

const timeOfDayPattern = /^(\d{2}):(\d{2})$/;
const minutesPerDay = 24 * 60;

export class TimeOfDay {
  private constructor(readonly minutes: number) {}

  static create(raw: string): TimeOfDay {
    const match = typeof raw === 'string' ? timeOfDayPattern.exec(raw.trim()) : null;
    if (!match) {
      throw new DomainError('time must be formatted as HH:MM');
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      throw new DomainError('time must be between 00:00 and 23:59');
    }
    return new TimeOfDay(hours * 60 + minutes);
  }

  static fromMinutes(minutes: number): TimeOfDay {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= minutesPerDay) {
      throw new DomainError('time must be between 00:00 and 23:59');
    }
    return new TimeOfDay(minutes);
  }

  static restore(minutes: number): TimeOfDay {
    return new TimeOfDay(minutes);
  }

  plusMinutes(minutes: number): TimeOfDay {
    return TimeOfDay.fromMinutes(this.minutes + minutes);
  }

  minutesUntil(other: TimeOfDay): number {
    return other.minutes - this.minutes;
  }

  isBefore(other: TimeOfDay): boolean {
    return this.minutes < other.minutes;
  }

  equals(other: TimeOfDay): boolean {
    return this.minutes === other.minutes;
  }

  toString(): string {
    const hours = String(Math.floor(this.minutes / 60)).padStart(2, '0');
    const minutes = String(this.minutes % 60).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

export type Slot = {
  startsAt: Date;
  endsAt: Date;
  unitId: string;
  modality: Modality;
};

export type ScheduleAvailabilityProps = {
  id: string;
  professionalId: string;
  unitId: string;
  weekday: number;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  slotMinutes: number;
  modality: Modality;
  createdAt: Date;
};

export type CreateScheduleAvailabilityProps = {
  professionalId: string;
  unitId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  modality: Modality;
};

export type UpdateScheduleAvailabilityProps = Partial<Omit<CreateScheduleAvailabilityProps, 'professionalId'>>;

type Schedule = Pick<ScheduleAvailabilityProps, 'unitId' | 'weekday' | 'startTime' | 'endTime' | 'slotMinutes' | 'modality'>;

function validSchedule(schedule: Schedule): Schedule {
  if (!schedule.unitId) {
    throw new DomainError('unitId is required');
  }
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7) {
    throw new DomainError('weekday must be between 1 (Monday) and 7 (Sunday)');
  }
  if (!schedule.startTime.isBefore(schedule.endTime)) {
    throw new DomainError('endTime must be after startTime');
  }
  const { slotMinutesMin, slotMinutesMax } = ScheduleAvailability;
  if (!Number.isInteger(schedule.slotMinutes) || schedule.slotMinutes < slotMinutesMin || schedule.slotMinutes > slotMinutesMax) {
    throw new DomainError(`slotMinutes must be between ${slotMinutesMin} and ${slotMinutesMax}`);
  }
  if (schedule.slotMinutes > schedule.startTime.minutesUntil(schedule.endTime)) {
    throw new DomainError('slotMinutes must fit between startTime and endTime');
  }
  if (!modalities.includes(schedule.modality)) {
    throw new DomainError(`modality must be one of ${modalities.join(', ')}`);
  }
  return schedule;
}

export class ScheduleAvailability {
  static readonly slotMinutesMin = 5;
  static readonly slotMinutesMax = 240;

  private constructor(private readonly props: ScheduleAvailabilityProps) {}

  static create(props: CreateScheduleAvailabilityProps, now: Date = new Date()): ScheduleAvailability {
    if (!props.professionalId) {
      throw new DomainError('professionalId is required');
    }
    const schedule = validSchedule({
      unitId: props.unitId,
      weekday: props.weekday,
      startTime: TimeOfDay.create(props.startTime),
      endTime: TimeOfDay.create(props.endTime),
      slotMinutes: props.slotMinutes,
      modality: props.modality,
    });
    return new ScheduleAvailability({ id: randomUUID(), professionalId: props.professionalId, ...schedule, createdAt: now });
  }

  static restore(props: ScheduleAvailabilityProps): ScheduleAvailability {
    return new ScheduleAvailability({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get professionalId() {
    return this.props.professionalId;
  }

  get unitId() {
    return this.props.unitId;
  }

  get weekday() {
    return this.props.weekday;
  }

  get startTime() {
    return this.props.startTime;
  }

  get endTime() {
    return this.props.endTime;
  }

  get slotMinutes() {
    return this.props.slotMinutes;
  }

  get modality() {
    return this.props.modality;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  update(changes: UpdateScheduleAvailabilityProps): void {
    const schedule = validSchedule({
      unitId: changes.unitId ?? this.props.unitId,
      weekday: changes.weekday ?? this.props.weekday,
      startTime: changes.startTime !== undefined ? TimeOfDay.create(changes.startTime) : this.props.startTime,
      endTime: changes.endTime !== undefined ? TimeOfDay.create(changes.endTime) : this.props.endTime,
      slotMinutes: changes.slotMinutes ?? this.props.slotMinutes,
      modality: changes.modality ?? this.props.modality,
    });
    Object.assign(this.props, schedule);
  }

  overlaps(other: ScheduleAvailability): boolean {
    return (
      this.props.weekday === other.weekday &&
      this.props.startTime.isBefore(other.endTime) &&
      other.startTime.isBefore(this.props.endTime)
    );
  }

  generateSlots(date: string, timeZone: string): Slot[] {
    if (isoWeekday(date) !== this.props.weekday) {
      return [];
    }
    const slots: Slot[] = [];
    const { startTime, endTime, slotMinutes, unitId, modality } = this.props;
    for (let start = startTime.minutes; start + slotMinutes <= endTime.minutes; start += slotMinutes) {
      slots.push({
        startsAt: zonedTimeToInstant(date, start, timeZone),
        endsAt: zonedTimeToInstant(date, start + slotMinutes, timeZone),
        unitId,
        modality,
      });
    }
    return slots;
  }
}
