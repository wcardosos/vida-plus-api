import { addDays, toZonedDate } from '../../../shared/time-zone';
import { Appointment } from '../entities/appointment.entity';
import type { ScheduleAvailability, Slot } from '../entities/schedule-availability.entity';
import type { ScheduleBlock } from '../entities/schedule-block.entity';

export type CandidateSlotsInput = {
  availabilities: ScheduleAvailability[];
  blocks: ScheduleBlock[];
  from: Date;
  to: Date;
  timeZone: string;
};

export type FreeSlotsInput = CandidateSlotsInput & {
  appointments: Appointment[];
  now: Date;
};

export function candidateSlots({ availabilities, blocks, from, to, timeZone }: CandidateSlotsInput): Slot[] {
  const slots: Slot[] = [];
  const lastDate = toZonedDate(to, timeZone);
  for (let date = toZonedDate(from, timeZone); date <= lastDate; date = addDays(date, 1)) {
    for (const availability of availabilities) {
      slots.push(...availability.generateSlots(date, timeZone));
    }
  }
  return slots
    .filter((slot) => slot.startsAt >= from && slot.endsAt <= to)
    .filter((slot) => !blocks.some((block) => block.overlaps(slot.startsAt, slot.endsAt)))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function freeSlots(input: FreeSlotsInput): Slot[] {
  return candidateSlots(input)
    .filter((slot) => Appointment.isSchedulableAt(slot.startsAt, input.now))
    .filter((slot) => !input.appointments.some((appointment) => appointment.overlaps(slot.startsAt, slot.endsAt)));
}
