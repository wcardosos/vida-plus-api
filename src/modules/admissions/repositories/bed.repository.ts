import { and, asc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { Bed, bedStatuses, type BedStatus, type BedType } from '../entities/bed.entity';
import { beds } from '../schema';

type BedRow = typeof beds.$inferSelect;

export type BedFilters = {
  status?: BedStatus;
  type?: BedType;
};

export type BedStatusSummary = Record<BedStatus, number>;

export type OccupancyMap = {
  beds: Bed[];
  summary: BedStatusSummary;
};

function toEntity(row: BedRow): Bed {
  return Bed.restore({
    id: row.id,
    unitId: row.unitId,
    identification: row.identification,
    sector: row.sector,
    type: row.type,
    status: row.status,
    createdAt: row.createdAt,
  });
}

export type BedRepository = ReturnType<typeof createBedRepository>;

export function createBedRepository(db: Database) {
  return {
    async insert(bed: Bed, executor: DbExecutor = db): Promise<void> {
      await executor.insert(beds).values({
        id: bed.id,
        unitId: bed.unitId,
        identification: bed.identification,
        sector: bed.sector,
        type: bed.type,
        status: bed.status,
        createdAt: bed.createdAt,
        updatedAt: bed.createdAt,
      });
    },

    async update(bed: Bed, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(beds)
        .set({ identification: bed.identification, sector: bed.sector, type: bed.type, status: bed.status, updatedAt: new Date() })
        .where(eq(beds.id, bed.id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Bed | null> {
      const [row] = await executor.select().from(beds).where(eq(beds.id, id));
      return row ? toEntity(row) : null;
    },

    async findByIds(ids: string[], executor: DbExecutor = db): Promise<Bed[]> {
      if (ids.length === 0) {
        return [];
      }
      const rows = await executor.select().from(beds).where(inArray(beds.id, ids));
      return rows.map(toEntity);
    },

    async lockByIds(ids: string[], tx: Transaction): Promise<Bed[]> {
      const unique = [...new Set(ids)].sort();
      if (unique.length === 0) {
        return [];
      }
      const rows = await tx.select().from(beds).where(inArray(beds.id, unique)).orderBy(asc(beds.id)).for('update');
      return rows.map(toEntity);
    },

    async existsByIdentification(unitId: string, identification: string, exceptId?: string, executor: DbExecutor = db): Promise<boolean> {
      const conditions: SQL[] = [eq(beds.unitId, unitId), eq(beds.identification, identification)];
      if (exceptId) conditions.push(ne(beds.id, exceptId));
      const [row] = await executor
        .select({ id: beds.id })
        .from(beds)
        .where(and(...conditions))
        .limit(1);
      return row !== undefined;
    },

    async findOccupancyMap(unitId: string, filters: BedFilters): Promise<OccupancyMap> {
      const conditions: SQL[] = [eq(beds.unitId, unitId)];
      if (filters.type) conditions.push(eq(beds.type, filters.type));
      const rows = await db
        .select()
        .from(beds)
        .where(and(...conditions))
        .orderBy(asc(beds.identification), asc(beds.id));

      const summary = Object.fromEntries(bedStatuses.map((status) => [status, 0])) as BedStatusSummary;
      for (const row of rows) {
        summary[row.status] += 1;
      }
      const listed = filters.status ? rows.filter((row) => row.status === filters.status) : rows;
      return { beds: listed.map(toEntity), summary };
    },
  };
}
