import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import type { Modality } from '../entities/appointment.entity';
import { ScheduleAvailability, TimeOfDay } from '../entities/schedule-availability.entity';
import { scheduleAvailabilities } from '../schema';

type ScheduleAvailabilityRow = typeof scheduleAvailabilities.$inferSelect;

export type AvailabilityFilters = {
  unitId?: string;
  modality?: Modality;
};

function timeOfDay(value: string): TimeOfDay {
  const [hours, minutes] = value.split(':').map(Number);
  return TimeOfDay.restore(hours * 60 + minutes);
}

function toEntity(row: ScheduleAvailabilityRow): ScheduleAvailability {
  return ScheduleAvailability.restore({
    id: row.id,
    professionalId: row.professionalId,
    unitId: row.unitId,
    weekday: row.weekday,
    startTime: timeOfDay(row.startTime),
    endTime: timeOfDay(row.endTime),
    slotMinutes: row.slotMinutes,
    modality: row.modality,
    createdAt: row.createdAt,
  });
}

function scheduleColumns(availability: ScheduleAvailability) {
  return {
    unitId: availability.unitId,
    weekday: availability.weekday,
    startTime: availability.startTime.toString(),
    endTime: availability.endTime.toString(),
    slotMinutes: availability.slotMinutes,
    modality: availability.modality,
  };
}

export type ScheduleAvailabilityRepository = ReturnType<typeof createScheduleAvailabilityRepository>;

export function createScheduleAvailabilityRepository(db: Database) {
  return {
    async insert(availability: ScheduleAvailability, executor: DbExecutor = db): Promise<void> {
      await executor.insert(scheduleAvailabilities).values({
        id: availability.id,
        professionalId: availability.professionalId,
        ...scheduleColumns(availability),
        createdAt: availability.createdAt,
        updatedAt: availability.createdAt,
      });
    },

    async update(availability: ScheduleAvailability, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(scheduleAvailabilities)
        .set({ ...scheduleColumns(availability), updatedAt: new Date() })
        .where(eq(scheduleAvailabilities.id, availability.id));
    },

    async delete(id: string, executor: DbExecutor = db): Promise<void> {
      await executor.delete(scheduleAvailabilities).where(eq(scheduleAvailabilities.id, id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<ScheduleAvailability | null> {
      const [row] = await executor.select().from(scheduleAvailabilities).where(eq(scheduleAvailabilities.id, id));
      return row ? toEntity(row) : null;
    },

    async findByProfessional(professionalId: string, filters: AvailabilityFilters = {}, executor: DbExecutor = db): Promise<ScheduleAvailability[]> {
      const conditions: SQL[] = [eq(scheduleAvailabilities.professionalId, professionalId)];
      if (filters.unitId) conditions.push(eq(scheduleAvailabilities.unitId, filters.unitId));
      if (filters.modality) conditions.push(eq(scheduleAvailabilities.modality, filters.modality));
      const rows = await executor
        .select()
        .from(scheduleAvailabilities)
        .where(and(...conditions))
        .orderBy(asc(scheduleAvailabilities.weekday), asc(scheduleAvailabilities.startTime), asc(scheduleAvailabilities.id));
      return rows.map(toEntity);
    },

    async lockProfessionalSchedule(professionalId: string, executor: Transaction): Promise<void> {
      await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`schedule-availabilities:${professionalId}`}, 0))`);
    },
  };
}
