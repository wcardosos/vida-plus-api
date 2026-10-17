import { and, asc, count, desc, eq, gt, gte, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { Appointment, type AppointmentStatus, type Modality } from '../entities/appointment.entity';
import { appointments } from '../schema';

type AppointmentRow = typeof appointments.$inferSelect;

export type OverlapFilter = {
  professionalId?: string;
  patientId?: string;
  unitId?: string;
  from: Date;
  to: Date;
  includeCanceled?: boolean;
};

export type AppointmentFilters = {
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
  professionalId?: string;
  patientId?: string;
  unitId?: string;
};

export type FutureAppointmentsFilter = {
  professionalId?: string;
  patientId?: string;
  unitId?: string;
  modality?: Modality;
  after: Date;
};

export type PatientAppointmentsFilter = {
  from?: Date;
  to?: Date;
};

export type Pagination = {
  page: number;
  pageSize: number;
};

function toEntity(row: AppointmentRow): Appointment {
  return Appointment.restore({
    id: row.id,
    patientId: row.patientId,
    professionalId: row.professionalId,
    unitId: row.unitId,
    modality: row.modality,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    cancellationReason: row.cancellationReason,
    canceledBy: row.canceledBy,
    canceledAt: row.canceledAt,
    createdAt: row.createdAt,
  });
}

const chronological = [asc(appointments.startsAt), asc(appointments.id)];

function scheduledAfter(filter: FutureAppointmentsFilter): SQL | undefined {
  const conditions: SQL[] = [eq(appointments.status, 'SCHEDULED'), gt(appointments.startsAt, filter.after)];
  if (filter.professionalId) conditions.push(eq(appointments.professionalId, filter.professionalId));
  if (filter.patientId) conditions.push(eq(appointments.patientId, filter.patientId));
  if (filter.unitId) conditions.push(eq(appointments.unitId, filter.unitId));
  if (filter.modality) conditions.push(eq(appointments.modality, filter.modality));
  return and(...conditions);
}

export type AppointmentRepository = ReturnType<typeof createAppointmentRepository>;

export function createAppointmentRepository(db: Database) {
  return {
    async insert(appointment: Appointment, executor: DbExecutor = db): Promise<void> {
      await executor.insert(appointments).values({
        id: appointment.id,
        patientId: appointment.patientId,
        professionalId: appointment.professionalId,
        unitId: appointment.unitId,
        modality: appointment.modality,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        cancellationReason: appointment.cancellationReason,
        canceledBy: appointment.canceledBy,
        canceledAt: appointment.canceledAt,
        createdAt: appointment.createdAt,
        updatedAt: appointment.createdAt,
      });
    },

    async update(appointment: Appointment, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(appointments)
        .set({
          status: appointment.status,
          cancellationReason: appointment.cancellationReason,
          canceledBy: appointment.canceledBy,
          canceledAt: appointment.canceledAt,
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, appointment.id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Appointment | null> {
      const [row] = await executor.select().from(appointments).where(eq(appointments.id, id));
      return row ? toEntity(row) : null;
    },

    async findByIdForUpdate(id: string, executor: Transaction): Promise<Appointment | null> {
      const [row] = await executor.select().from(appointments).where(eq(appointments.id, id)).for('update');
      return row ? toEntity(row) : null;
    },

    async findOverlapping(filter: OverlapFilter, executor: DbExecutor = db): Promise<Appointment[]> {
      const conditions: SQL[] = [lt(appointments.startsAt, filter.to), gt(appointments.endsAt, filter.from)];
      if (filter.professionalId) conditions.push(eq(appointments.professionalId, filter.professionalId));
      if (filter.patientId) conditions.push(eq(appointments.patientId, filter.patientId));
      if (filter.unitId) conditions.push(eq(appointments.unitId, filter.unitId));
      if (!filter.includeCanceled) conditions.push(ne(appointments.status, 'CANCELED'));
      const rows = await executor
        .select()
        .from(appointments)
        .where(and(...conditions))
        .orderBy(...chronological);
      return rows.map(toEntity);
    },

    async findScheduledAfter(filter: FutureAppointmentsFilter, executor: DbExecutor = db): Promise<Appointment[]> {
      const rows = await executor
        .select()
        .from(appointments)
        .where(scheduledAfter(filter))
        .orderBy(...chronological);
      return rows.map(toEntity);
    },

    async findScheduledAfterForUpdate(filter: FutureAppointmentsFilter, executor: Transaction): Promise<Appointment[]> {
      const rows = await executor
        .select()
        .from(appointments)
        .where(scheduledAfter(filter))
        .orderBy(...chronological)
        .for('update');
      return rows.map(toEntity);
    },

    async findMany(filters: AppointmentFilters, { page, pageSize }: Pagination): Promise<{ items: Appointment[]; total: number }> {
      const conditions: SQL[] = [];
      if (filters.status) conditions.push(eq(appointments.status, filters.status));
      if (filters.from) conditions.push(gte(appointments.startsAt, filters.from));
      if (filters.to) conditions.push(lt(appointments.startsAt, filters.to));
      if (filters.professionalId) conditions.push(eq(appointments.professionalId, filters.professionalId));
      if (filters.patientId) conditions.push(eq(appointments.patientId, filters.patientId));
      if (filters.unitId) conditions.push(eq(appointments.unitId, filters.unitId));
      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(appointments)
          .where(where)
          .orderBy(...chronological)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(appointments).where(where),
      ]);
      return { items: rows.map(toEntity), total };
    },

    async findByPatient(patientId: string, filter: PatientAppointmentsFilter): Promise<Appointment[]> {
      const conditions: SQL[] = [eq(appointments.patientId, patientId)];
      if (filter.from) conditions.push(gte(appointments.startsAt, filter.from));
      if (filter.to) conditions.push(lt(appointments.startsAt, filter.to));
      const rows = await db
        .select()
        .from(appointments)
        .where(and(...conditions))
        .orderBy(desc(appointments.startsAt), desc(appointments.id));
      return rows.map(toEntity);
    },

    async existsNotCanceledBetween(professionalId: string, patientId: string): Promise<boolean> {
      const [row] = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.professionalId, professionalId), eq(appointments.patientId, patientId), ne(appointments.status, 'CANCELED')))
        .limit(1);
      return row !== undefined;
    },

    async lockPatientSchedule(patientId: string, executor: Transaction): Promise<void> {
      await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`appointments:patient:${patientId}`}, 0))`);
    },
  };
}
