import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { AdmissionMovement } from '../entities/admission-movement.entity';
import { Admission, type AdmissionStatus } from '../entities/admission.entity';
import { admissionMovements, admissions } from '../schema';

type AdmissionRow = typeof admissions.$inferSelect;
type AdmissionMovementRow = typeof admissionMovements.$inferSelect;

export type AdmissionFilters = {
  unitId?: string;
  status?: AdmissionStatus;
};

export type ActiveAdmissionsFilter = {
  professionalId?: string;
  unitId?: string;
};

export type Period = {
  from?: Date;
  to?: Date;
};

export type Pagination = {
  page: number;
  pageSize: number;
};

function toMovement(row: AdmissionMovementRow): AdmissionMovement {
  return AdmissionMovement.restore({
    id: row.id,
    admissionId: row.admissionId,
    type: row.type,
    fromBedId: row.fromBedId,
    toBedId: row.toBedId,
    occurredAt: row.occurredAt,
  });
}

function movementValues(admission: Admission) {
  return admission.getMovements().map((movement) => ({
    id: movement.id,
    admissionId: movement.admissionId,
    type: movement.type,
    fromBedId: movement.fromBedId,
    toBedId: movement.toBedId,
    occurredAt: movement.occurredAt,
  }));
}

const newestFirst = [desc(admissions.admittedAt), desc(admissions.id)];

export type AdmissionRepository = ReturnType<typeof createAdmissionRepository>;

export function createAdmissionRepository(db: Database) {
  async function withMovements(rows: AdmissionRow[], executor: DbExecutor): Promise<Admission[]> {
    if (rows.length === 0) {
      return [];
    }
    const movementRows = await executor
      .select()
      .from(admissionMovements)
      .where(
        inArray(
          admissionMovements.admissionId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(admissionMovements.occurredAt), asc(admissionMovements.id));
    const movementsOf = new Map<string, AdmissionMovement[]>();
    for (const movementRow of movementRows) {
      movementsOf.set(movementRow.admissionId, [...(movementsOf.get(movementRow.admissionId) ?? []), toMovement(movementRow)]);
    }
    return rows.map((row) =>
      Admission.restore({
        id: row.id,
        patientId: row.patientId,
        unitId: row.unitId,
        currentBedId: row.currentBedId,
        responsibleProfessionalId: row.responsibleProfessionalId,
        status: row.status,
        admittedAt: row.admittedAt,
        dischargedAt: row.dischargedAt,
        movements: movementsOf.get(row.id) ?? [],
      }),
    );
  }

  async function one(rows: AdmissionRow[], executor: DbExecutor): Promise<Admission | null> {
    const [admission] = await withMovements(rows, executor);
    return admission ?? null;
  }

  return {
    async insert(admission: Admission, tx: Transaction): Promise<void> {
      await tx.insert(admissions).values({
        id: admission.id,
        patientId: admission.patientId,
        unitId: admission.unitId,
        currentBedId: admission.currentBedId,
        responsibleProfessionalId: admission.responsibleProfessionalId,
        status: admission.status,
        admittedAt: admission.admittedAt,
        dischargedAt: admission.dischargedAt,
      });
      await tx.insert(admissionMovements).values(movementValues(admission));
    },

    async update(admission: Admission, tx: Transaction): Promise<void> {
      await tx
        .update(admissions)
        .set({ currentBedId: admission.currentBedId, status: admission.status, dischargedAt: admission.dischargedAt })
        .where(eq(admissions.id, admission.id));
      await tx.insert(admissionMovements).values(movementValues(admission)).onConflictDoNothing({ target: admissionMovements.id });
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Admission | null> {
      return one(await executor.select().from(admissions).where(eq(admissions.id, id)), executor);
    },

    async findByIdForUpdate(id: string, tx: Transaction): Promise<Admission | null> {
      return one(await tx.select().from(admissions).where(eq(admissions.id, id)).for('update'), tx);
    },

    async findByIdForShare(id: string, tx: Transaction): Promise<Admission | null> {
      return one(await tx.select().from(admissions).where(eq(admissions.id, id)).for('share'), tx);
    },

    async existsActiveByPatient(patientId: string, executor: DbExecutor = db): Promise<boolean> {
      const [row] = await executor
        .select({ id: admissions.id })
        .from(admissions)
        .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'ACTIVE')))
        .limit(1);
      return row !== undefined;
    },

    async findMany(filters: AdmissionFilters, { page, pageSize }: Pagination): Promise<{ items: Admission[]; total: number }> {
      const conditions: SQL[] = [];
      if (filters.unitId) conditions.push(eq(admissions.unitId, filters.unitId));
      if (filters.status) conditions.push(eq(admissions.status, filters.status));
      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(admissions)
          .where(where)
          .orderBy(...newestFirst)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(admissions).where(where),
      ]);
      return { items: await withMovements(rows, db), total };
    },

    async findActiveByResponsible(professionalId: string): Promise<Admission[]> {
      const rows = await db
        .select()
        .from(admissions)
        .where(and(eq(admissions.responsibleProfessionalId, professionalId), eq(admissions.status, 'ACTIVE')))
        .orderBy(asc(admissions.admittedAt), asc(admissions.id));
      return withMovements(rows, db);
    },

    async countActive(filter: ActiveAdmissionsFilter, executor: DbExecutor = db): Promise<number> {
      const conditions: SQL[] = [eq(admissions.status, 'ACTIVE')];
      if (filter.professionalId) conditions.push(eq(admissions.responsibleProfessionalId, filter.professionalId));
      if (filter.unitId) conditions.push(eq(admissions.unitId, filter.unitId));
      const [{ total }] = await executor
        .select({ total: count() })
        .from(admissions)
        .where(and(...conditions));
      return total;
    },

    async existsByResponsibleAndPatient(professionalId: string, patientId: string): Promise<boolean> {
      const [row] = await db
        .select({ id: admissions.id })
        .from(admissions)
        .where(and(eq(admissions.responsibleProfessionalId, professionalId), eq(admissions.patientId, patientId)))
        .limit(1);
      return row !== undefined;
    },

    async findByPatient(patientId: string, period: Period): Promise<Admission[]> {
      const conditions: SQL[] = [eq(admissions.patientId, patientId)];
      if (period.to) conditions.push(lt(admissions.admittedAt, period.to));
      if (period.from) conditions.push(or(isNull(admissions.dischargedAt), gte(admissions.dischargedAt, period.from))!);
      const rows = await db
        .select()
        .from(admissions)
        .where(and(...conditions))
        .orderBy(...newestFirst);
      return withMovements(rows, db);
    },
  };
}
