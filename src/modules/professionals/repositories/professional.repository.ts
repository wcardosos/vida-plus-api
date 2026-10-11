import { and, asc, count, eq, exists, ilike, inArray, ne, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import type { BrazilianState } from '../../../shared/value-objects/address';
import { users } from '../../auth/schema';
import { CouncilRegistration, Professional, type ProfessionalCategory } from '../entities/professional.entity';
import { professionals, professionalUnits } from '../schema';

type ProfessionalRow = typeof professionals.$inferSelect;

export type ProfessionalAccount = {
  email: string;
  active: boolean;
};

export type ProfessionalWithAccount = {
  professional: Professional;
  account: ProfessionalAccount;
};

export type ProfessionalFilters = {
  unitId?: string;
  category?: ProfessionalCategory;
  specialty?: string;
  active?: boolean;
};

export type Pagination = {
  page: number;
  pageSize: number;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toEntity(row: ProfessionalRow, unitIds: string[]): Professional {
  return Professional.restore({
    id: row.id,
    userId: row.userId,
    name: row.name,
    category: row.category,
    registration: CouncilRegistration.restore({
      council: row.council,
      number: row.registrationNumber,
      state: row.registrationState as BrazilianState,
    }),
    specialty: row.specialty,
    unitIds,
    createdAt: row.createdAt,
  });
}

function registrationColumns(professional: Professional) {
  return {
    council: professional.registration.council,
    registrationNumber: professional.registration.number,
    registrationState: professional.registration.state,
  };
}

export type ProfessionalRepository = ReturnType<typeof createProfessionalRepository>;

export function createProfessionalRepository(db: Database) {
  async function loadUnitIds(professionalIds: string[], executor: DbExecutor): Promise<Map<string, string[]>> {
    const byProfessional = new Map<string, string[]>(professionalIds.map((id) => [id, []]));
    if (professionalIds.length === 0) {
      return byProfessional;
    }
    const rows = await executor
      .select({ professionalId: professionalUnits.professionalId, unitId: professionalUnits.unitId })
      .from(professionalUnits)
      .where(inArray(professionalUnits.professionalId, professionalIds))
      .orderBy(asc(professionalUnits.createdAt), asc(professionalUnits.unitId));
    for (const row of rows) {
      byProfessional.get(row.professionalId)?.push(row.unitId);
    }
    return byProfessional;
  }

  async function withUnits(row: ProfessionalRow | undefined, executor: DbExecutor): Promise<Professional | null> {
    if (!row) {
      return null;
    }
    const unitIds = await loadUnitIds([row.id], executor);
    return toEntity(row, unitIds.get(row.id) ?? []);
  }

  return {
    async insert(professional: Professional, executor: DbExecutor = db): Promise<void> {
      await executor.insert(professionals).values({
        id: professional.id,
        userId: professional.userId,
        name: professional.name,
        category: professional.category,
        ...registrationColumns(professional),
        specialty: professional.specialty,
        createdAt: professional.createdAt,
        updatedAt: professional.createdAt,
      });
      await executor
        .insert(professionalUnits)
        .values(professional.unitIds.map((unitId) => ({ professionalId: professional.id, unitId, createdAt: professional.createdAt })));
    },

    async update(professional: Professional, executor: Transaction): Promise<void> {
      await executor
        .update(professionals)
        .set({
          name: professional.name,
          category: professional.category,
          ...registrationColumns(professional),
          specialty: professional.specialty,
          updatedAt: new Date(),
        })
        .where(eq(professionals.id, professional.id));

      const stored = (await loadUnitIds([professional.id], executor)).get(professional.id) ?? [];
      const current = professional.unitIds;
      const removed = stored.filter((unitId) => !current.includes(unitId));
      const added = current.filter((unitId) => !stored.includes(unitId));

      if (removed.length > 0) {
        await executor
          .delete(professionalUnits)
          .where(and(eq(professionalUnits.professionalId, professional.id), inArray(professionalUnits.unitId, removed)));
      }
      if (added.length > 0) {
        await executor.insert(professionalUnits).values(added.map((unitId) => ({ professionalId: professional.id, unitId })));
      }
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Professional | null> {
      const [row] = await executor.select().from(professionals).where(eq(professionals.id, id));
      return withUnits(row, executor);
    },

    async findByIdForUpdate(id: string, executor: Transaction): Promise<Professional | null> {
      const [row] = await executor.select().from(professionals).where(eq(professionals.id, id)).for('update');
      return withUnits(row, executor);
    },

    async findByIds(ids: string[]): Promise<Professional[]> {
      if (ids.length === 0) {
        return [];
      }
      const rows = await db.select().from(professionals).where(inArray(professionals.id, ids));
      const unitIds = await loadUnitIds(
        rows.map((row) => row.id),
        db,
      );
      return rows.map((row) => toEntity(row, unitIds.get(row.id) ?? []));
    },

    async findByUserId(userId: string, executor: DbExecutor = db): Promise<Professional | null> {
      const [row] = await executor.select().from(professionals).where(eq(professionals.userId, userId));
      return withUnits(row, executor);
    },

    async existsByRegistration(registration: CouncilRegistration, exceptId?: string, executor: DbExecutor = db): Promise<boolean> {
      const conditions: SQL[] = [
        eq(professionals.council, registration.council),
        eq(professionals.registrationNumber, registration.number),
        eq(professionals.registrationState, registration.state),
      ];
      if (exceptId) conditions.push(ne(professionals.id, exceptId));
      const [row] = await executor
        .select({ id: professionals.id })
        .from(professionals)
        .where(and(...conditions));
      return row !== undefined;
    },

    async findMany(filters: ProfessionalFilters, { page, pageSize }: Pagination): Promise<{ items: ProfessionalWithAccount[]; total: number }> {
      const conditions: SQL[] = [];
      if (filters.unitId) {
        conditions.push(
          exists(
            db
              .select({ unitId: professionalUnits.unitId })
              .from(professionalUnits)
              .where(and(eq(professionalUnits.professionalId, professionals.id), eq(professionalUnits.unitId, filters.unitId))),
          ),
        );
      }
      if (filters.category) conditions.push(eq(professionals.category, filters.category));
      if (filters.specialty) conditions.push(ilike(professionals.specialty, `%${escapeLike(filters.specialty)}%`));
      if (filters.active !== undefined) conditions.push(eq(users.active, filters.active));
      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({ professional: professionals, email: users.email, active: users.active })
          .from(professionals)
          .innerJoin(users, eq(users.id, professionals.userId))
          .where(where)
          .orderBy(asc(professionals.name), asc(professionals.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(professionals).innerJoin(users, eq(users.id, professionals.userId)).where(where),
      ]);

      const unitIds = await loadUnitIds(
        rows.map((row) => row.professional.id),
        db,
      );
      return {
        items: rows.map((row) => ({
          professional: toEntity(row.professional, unitIds.get(row.professional.id) ?? []),
          account: { email: row.email, active: row.active },
        })),
        total,
      };
    },
  };
}
