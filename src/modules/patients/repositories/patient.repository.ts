import { and, asc, count, eq, like, sql, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { Address, type BrazilianState } from '../../../shared/value-objects/address';
import { users } from '../../auth/schema';
import { Cpf, Patient } from '../entities/patient.entity';
import { patients } from '../schema';

type PatientRow = typeof patients.$inferSelect;

export type PatientAccount = {
  email: string;
  active: boolean;
};

export type PatientWithAccount = {
  patient: Patient;
  account: PatientAccount;
};

export type PatientFilters = {
  search?: string;
  active?: boolean;
};

export type Pagination = {
  page: number;
  pageSize: number;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function searchCondition(search: string): SQL {
  if (/^[\d.\-\s]+$/.test(search)) {
    const digits = search.replace(/\D/g, '');
    if (digits) {
      return like(patients.cpf, `${digits}%`);
    }
  }
  return like(sql`lower(${patients.name})`, `%${escapeLike(search.toLowerCase())}%`);
}

function toEntity(row: PatientRow): Patient {
  return Patient.restore({
    id: row.id,
    userId: row.userId,
    name: row.name,
    cpf: Cpf.restore(row.cpf),
    birthDate: row.birthDate,
    phone: row.phone,
    address: Address.restore({
      street: row.addressStreet,
      number: row.addressNumber,
      complement: row.addressComplement,
      district: row.addressDistrict,
      city: row.addressCity,
      state: row.addressState as BrazilianState,
      zipCode: row.addressZipCode,
    }),
    termsVersion: row.termsVersion,
    termsAcceptedAt: row.termsAcceptedAt,
    createdAt: row.createdAt,
  });
}

function addressColumns(address: Address) {
  return {
    addressStreet: address.street,
    addressNumber: address.number,
    addressComplement: address.complement,
    addressDistrict: address.district,
    addressCity: address.city,
    addressState: address.state,
    addressZipCode: address.zipCode,
  };
}

export type PatientRepository = ReturnType<typeof createPatientRepository>;

export function createPatientRepository(db: Database) {
  return {
    async insert(patient: Patient, executor: DbExecutor = db): Promise<void> {
      await executor.insert(patients).values({
        id: patient.id,
        userId: patient.userId,
        name: patient.name,
        cpf: patient.cpf.value,
        birthDate: patient.birthDate,
        phone: patient.phone,
        ...addressColumns(patient.address),
        termsVersion: patient.termsVersion,
        termsAcceptedAt: patient.termsAcceptedAt,
        createdAt: patient.createdAt,
        updatedAt: patient.createdAt,
      });
    },

    async update(patient: Patient, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(patients)
        .set({
          name: patient.name,
          cpf: patient.cpf.value,
          birthDate: patient.birthDate,
          phone: patient.phone,
          ...addressColumns(patient.address),
          updatedAt: new Date(),
        })
        .where(eq(patients.id, patient.id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Patient | null> {
      const [row] = await executor.select().from(patients).where(eq(patients.id, id));
      return row ? toEntity(row) : null;
    },

    async findByIdForUpdate(id: string, executor: Transaction): Promise<Patient | null> {
      const [row] = await executor.select().from(patients).where(eq(patients.id, id)).for('update');
      return row ? toEntity(row) : null;
    },

    async findByUserId(userId: string, executor: DbExecutor = db): Promise<Patient | null> {
      const [row] = await executor.select().from(patients).where(eq(patients.userId, userId));
      return row ? toEntity(row) : null;
    },

    async findByUserIdForUpdate(userId: string, executor: Transaction): Promise<Patient | null> {
      const [row] = await executor.select().from(patients).where(eq(patients.userId, userId)).for('update');
      return row ? toEntity(row) : null;
    },

    async existsByCpf(cpf: string, executor: DbExecutor = db): Promise<boolean> {
      const [row] = await executor.select({ id: patients.id }).from(patients).where(eq(patients.cpf, cpf));
      return row !== undefined;
    },

    async findMany(filters: PatientFilters, { page, pageSize }: Pagination): Promise<{ items: PatientWithAccount[]; total: number }> {
      const conditions: SQL[] = [];
      if (filters.search) conditions.push(searchCondition(filters.search));
      if (filters.active !== undefined) conditions.push(eq(users.active, filters.active));
      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({ patient: patients, email: users.email, active: users.active })
          .from(patients)
          .innerJoin(users, eq(users.id, patients.userId))
          .where(where)
          .orderBy(asc(patients.name), asc(patients.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(patients).innerJoin(users, eq(users.id, patients.userId)).where(where),
      ]);

      return {
        items: rows.map((row) => ({ patient: toEntity(row.patient), account: { email: row.email, active: row.active } })),
        total,
      };
    },
  };
}
