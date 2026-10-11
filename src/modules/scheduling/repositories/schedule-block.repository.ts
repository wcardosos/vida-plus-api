import { and, asc, eq, gt, lt, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../db/client';
import { ScheduleBlock } from '../entities/schedule-block.entity';
import { scheduleBlocks } from '../schema';

type ScheduleBlockRow = typeof scheduleBlocks.$inferSelect;

export type Period = {
  from?: Date;
  to?: Date;
};

function toEntity(row: ScheduleBlockRow): ScheduleBlock {
  return ScheduleBlock.restore({
    id: row.id,
    professionalId: row.professionalId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason,
    createdAt: row.createdAt,
  });
}

export type ScheduleBlockRepository = ReturnType<typeof createScheduleBlockRepository>;

export function createScheduleBlockRepository(db: Database) {
  return {
    async insert(block: ScheduleBlock, executor: DbExecutor = db): Promise<void> {
      await executor.insert(scheduleBlocks).values({
        id: block.id,
        professionalId: block.professionalId,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        reason: block.reason,
        createdAt: block.createdAt,
      });
    },

    async delete(id: string, executor: DbExecutor = db): Promise<void> {
      await executor.delete(scheduleBlocks).where(eq(scheduleBlocks.id, id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<ScheduleBlock | null> {
      const [row] = await executor.select().from(scheduleBlocks).where(eq(scheduleBlocks.id, id));
      return row ? toEntity(row) : null;
    },

    async findOverlapping(professionalId: string, { from, to }: Period, executor: DbExecutor = db): Promise<ScheduleBlock[]> {
      const conditions: SQL[] = [eq(scheduleBlocks.professionalId, professionalId)];
      if (from) conditions.push(gt(scheduleBlocks.endsAt, from));
      if (to) conditions.push(lt(scheduleBlocks.startsAt, to));
      const rows = await executor
        .select()
        .from(scheduleBlocks)
        .where(and(...conditions))
        .orderBy(asc(scheduleBlocks.startsAt), asc(scheduleBlocks.id));
      return rows.map(toEntity);
    },
  };
}
