import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createContainer } from '../../src/container';
import { db, pool } from '../../src/db/client';
import { DomainError, NotFoundError } from '../../src/shared/errors';
import { clearUnits, insertUnit } from './helpers';

const { services } = createContainer({ db, logger: pino({ level: 'silent' }) });
const unitsService = services.units;

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await clearUnits();
});

describe('unitsService.getActiveById', () => {
  it('returns an active unit', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });

    expect((await unitsService.getActiveById(unit.id)).id).toBe(unit.id);
  });

  it('returns an active unit inside the caller transaction', async () => {
    const unit = await insertUnit();

    const found = await db.transaction((tx) => unitsService.getActiveById(unit.id, tx));

    expect(found.id).toBe(unit.id);
  });

  it('throws NotFoundError for a unit that does not exist', async () => {
    await expect(unitsService.getActiveById(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws DomainError for an inactive unit', async () => {
    const unit = await insertUnit({ active: false });

    await expect(unitsService.getActiveById(unit.id)).rejects.toThrow(new DomainError('Unit is inactive'));
  });
});

describe('unitsService.assertLaboratory', () => {
  it('returns an active laboratory', async () => {
    const unit = await insertUnit({ type: 'LABORATORY' });

    expect((await unitsService.assertLaboratory(unit.id)).id).toBe(unit.id);
  });

  it('throws DomainError for a unit that is not a laboratory', async () => {
    const unit = await insertUnit({ type: 'CLINIC' });

    await expect(unitsService.assertLaboratory(unit.id)).rejects.toThrow(new DomainError('Unit is not a laboratory'));
  });

  it('throws DomainError for an inactive laboratory', async () => {
    const unit = await insertUnit({ type: 'LABORATORY', active: false });

    await expect(unitsService.assertLaboratory(unit.id)).rejects.toThrow(new DomainError('Unit is inactive'));
  });
});

describe('unitsService.existsById', () => {
  it('is true for active and inactive units and false otherwise', async () => {
    const active = await insertUnit();
    const inactive = await insertUnit({ active: false });

    expect(await unitsService.existsById(active.id)).toBe(true);
    expect(await unitsService.existsById(inactive.id)).toBe(true);
    expect(await unitsService.existsById(randomUUID())).toBe(false);
  });
});

describe('unitsService.deactivate', () => {
  it('passes the unit id and the transaction to every registered check', async () => {
    const { services: isolated } = createContainer({ db, logger: pino({ level: 'silent' }) });
    const unit = await insertUnit();
    const calls: string[] = [];
    isolated.units.registerDeactivationCheck(async (unitId, tx) => {
      calls.push(unitId);
      expect(await isolated.units.existsById(unitId)).toBe(true);
      expect(tx).toBeDefined();
      return null;
    });
    isolated.units.registerDeactivationCheck(async () => ({ type: 'ACTIVE_ADMISSIONS', count: 0 }));

    await isolated.units.deactivate(unit.id);

    expect(calls).toEqual([unit.id]);
    expect(await isolated.units.getActiveById(unit.id).catch((error) => error)).toBeInstanceOf(DomainError);
  });

  it('reports every check that found pendencies', async () => {
    const { services: isolated } = createContainer({ db, logger: pino({ level: 'silent' }) });
    const unit = await insertUnit();
    isolated.units.registerDeactivationCheck(async () => ({ type: 'FUTURE_APPOINTMENTS', count: 2 }));
    isolated.units.registerDeactivationCheck(async () => ({ type: 'ACTIVE_ADMISSIONS', count: 1 }));

    const error = await isolated.units.deactivate(unit.id).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).payload).toEqual({
      pendencies: [
        { type: 'FUTURE_APPOINTMENTS', count: 2 },
        { type: 'ACTIVE_ADMISSIONS', count: 1 },
      ],
    });
  });
});
