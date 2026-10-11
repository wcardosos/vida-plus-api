import { and, asc, count, eq, ilike, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import { Address, type BrazilianState } from '../../../shared/value-objects/address';
import { Cnpj, Unit, type UnitType } from '../entities/unit.entity';
import { units } from '../schema';

type UnitRow = typeof units.$inferSelect;

export type UnitFilters = {
  type?: UnitType;
  name?: string;
  city?: string;
  state?: BrazilianState;
  active?: boolean;
};

export type Pagination = {
  limit: number;
  offset: number;
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toEntity(row: UnitRow): Unit {
  return Unit.restore({
    id: row.id,
    name: row.name,
    type: row.type,
    cnpj: Cnpj.restore(row.cnpj),
    address: Address.restore({
      street: row.addressStreet,
      number: row.addressNumber,
      complement: row.addressComplement,
      district: row.addressDistrict,
      city: row.addressCity,
      state: row.addressState as BrazilianState,
      zipCode: row.addressZipCode,
    }),
    active: row.active,
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

export type UnitRepository = ReturnType<typeof createUnitRepository>;

export function createUnitRepository(db: Database) {
  return {
    async insert(unit: Unit, executor: DbExecutor = db): Promise<void> {
      await executor.insert(units).values({
        id: unit.id,
        name: unit.name,
        type: unit.type,
        cnpj: unit.cnpj.value,
        ...addressColumns(unit.address),
        active: unit.active,
        createdAt: unit.createdAt,
        updatedAt: unit.createdAt,
      });
    },

    async update(unit: Unit, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(units)
        .set({ name: unit.name, ...addressColumns(unit.address), active: unit.active, updatedAt: new Date() })
        .where(eq(units.id, unit.id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Unit | null> {
      const [row] = await executor.select().from(units).where(eq(units.id, id));
      return row ? toEntity(row) : null;
    },

    async findByIdForUpdate(id: string, executor: Transaction): Promise<Unit | null> {
      const [row] = await executor.select().from(units).where(eq(units.id, id)).for('update');
      return row ? toEntity(row) : null;
    },

    async findByIdForShare(id: string, executor: Transaction): Promise<Unit | null> {
      const [row] = await executor.select().from(units).where(eq(units.id, id)).for('share');
      return row ? toEntity(row) : null;
    },

    async existsById(id: string): Promise<boolean> {
      const [row] = await db.select({ id: units.id }).from(units).where(eq(units.id, id));
      return row !== undefined;
    },

    async existsByCnpj(cnpj: string): Promise<boolean> {
      const [row] = await db.select({ id: units.id }).from(units).where(eq(units.cnpj, cnpj));
      return row !== undefined;
    },

    async findMany(filters: UnitFilters, { limit, offset }: Pagination): Promise<{ items: Unit[]; total: number }> {
      const conditions: SQL[] = [];
      if (filters.type) conditions.push(eq(units.type, filters.type));
      if (filters.name) conditions.push(ilike(units.name, `%${escapeLike(filters.name)}%`));
      if (filters.city) conditions.push(ilike(units.addressCity, escapeLike(filters.city)));
      if (filters.state) conditions.push(eq(units.addressState, filters.state));
      if (filters.active !== undefined) conditions.push(eq(units.active, filters.active));
      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(units).where(where).orderBy(asc(units.name), asc(units.id)).limit(limit).offset(offset),
        db.select({ total: count() }).from(units).where(where),
      ]);

      return { items: rows.map(toEntity), total };
    },
  };
}
