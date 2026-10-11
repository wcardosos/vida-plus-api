import type { Database, Transaction } from '../../../db/client';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/errors';
import type { Role } from '../../../shared/roles';
import { Unit, type CreateUnitProps, type UpdateUnitProps } from '../entities/unit.entity';
import type { Pagination, UnitFilters, UnitRepository } from '../repositories/unit.repository';

export type UnitPendency = {
  type: string;
  count: number;
};

export type UnitDeactivationCheck = (unitId: string, tx: Transaction) => Promise<UnitPendency | null>;

export type UnitViewer = {
  role: Role;
};

export type UnitsService = ReturnType<typeof createUnitsService>;

export function createUnitsService(deps: { db: Database; units: UnitRepository }) {
  const { db, units } = deps;
  const deactivationChecks: UnitDeactivationCheck[] = [];

  function canSeeInactive(viewer: UnitViewer): boolean {
    return viewer.role === 'ADMIN';
  }

  function registerDeactivationCheck(check: UnitDeactivationCheck): void {
    deactivationChecks.push(check);
  }

  async function create(input: CreateUnitProps): Promise<Unit> {
    const unit = Unit.create(input);
    if (await units.existsByCnpj(unit.cnpj.value)) {
      throw new ConflictError('CNPJ is already registered');
    }
    await units.insert(unit);
    return unit;
  }

  async function list(viewer: UnitViewer, filters: UnitFilters, pagination: Pagination) {
    return units.findMany({ ...filters, active: canSeeInactive(viewer) ? filters.active : true }, pagination);
  }

  async function getById(viewer: UnitViewer, id: string): Promise<Unit> {
    const unit = await units.findById(id);
    if (!unit || (!unit.isActive() && !canSeeInactive(viewer))) {
      throw new NotFoundError('Unit not found');
    }
    return unit;
  }

  async function update(id: string, changes: UpdateUnitProps): Promise<Unit> {
    return db.transaction(async (tx) => {
      const unit = await units.findByIdForUpdate(id, tx);
      if (!unit) {
        throw new NotFoundError('Unit not found');
      }
      unit.update(changes);
      await units.update(unit, tx);
      return unit;
    });
  }

  async function deactivate(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const unit = await units.findByIdForUpdate(id, tx);
      if (!unit) {
        throw new NotFoundError('Unit not found');
      }
      if (!unit.isActive()) {
        return;
      }

      const pendencies: UnitPendency[] = [];
      for (const check of deactivationChecks) {
        const pendency = await check(unit.id, tx);
        if (pendency && pendency.count > 0) {
          pendencies.push(pendency);
        }
      }
      if (pendencies.length > 0) {
        throw new DomainError('Unit has pendencies that prevent its deactivation', { pendencies });
      }

      unit.deactivate();
      await units.update(unit, tx);
    });
  }

  async function getActiveById(id: string, tx?: Transaction): Promise<Unit> {
    const unit = tx ? await units.findByIdForShare(id, tx) : await units.findById(id);
    if (!unit) {
      throw new NotFoundError('Unit not found');
    }
    if (!unit.isActive()) {
      throw new DomainError('Unit is inactive');
    }
    return unit;
  }

  async function assertLaboratory(id: string, tx?: Transaction): Promise<Unit> {
    const unit = await getActiveById(id, tx);
    if (!unit.isLaboratory()) {
      throw new DomainError('Unit is not a laboratory');
    }
    return unit;
  }

  async function existsById(id: string): Promise<boolean> {
    return units.existsById(id);
  }

  async function listByIds(ids: string[]): Promise<Unit[]> {
    return units.findByIds([...new Set(ids)]);
  }

  return { registerDeactivationCheck, create, list, getById, update, deactivate, getActiveById, assertLaboratory, existsById, listByIds };
}
