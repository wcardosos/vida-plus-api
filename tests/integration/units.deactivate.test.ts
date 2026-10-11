import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import type { Role } from '../../src/shared/roles';
import { clearUnits, clearUsers, findUnits, insertAppointment, insertPatient, insertProfessional, insertUnit, tokenFor } from './helpers';
import { clock, localTime, monday } from './scheduling-helpers';

const unitsWithFutureAppointments = new Set<string>();

const app = buildApp({
  clock,
  configureContainer: (container) => {
    container.services.units.registerDeactivationCheck(async (unitId) =>
      unitsWithFutureAppointments.has(unitId) ? { type: 'FUTURE_APPOINTMENTS', count: 3 } : null,
    );
  },
});

async function deactivateUnit(id: string, role: Role = 'ADMIN') {
  return app.inject({ method: 'POST', url: `/units/${id}/deactivate`, headers: { authorization: `Bearer ${await tokenFor(app, role)}` } });
}

async function patientListing() {
  const response = await app.inject({ method: 'GET', url: '/units', headers: { authorization: `Bearer ${await tokenFor(app, 'PATIENT')}` } });
  return response.json().items.map((item: { id: string }) => item.id);
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  unitsWithFutureAppointments.clear();
  await clearUnits();
  await clearUsers();
});

describe('POST /units/:id/deactivate', () => {
  it('without pendencies: responds 204 and the unit disappears from the patient listing', async () => {
    const unit = await insertUnit();
    const other = await insertUnit();

    const response = await deactivateUnit(unit.id);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(await patientListing()).toEqual([other.id]);
    expect((await findUnits()).find((row) => row.id === unit.id)?.active).toBe(false);
  });

  it('with pendencies: responds 422 listing them and the unit stays active', async () => {
    const unit = await insertUnit();
    unitsWithFutureAppointments.add(unit.id);

    const response = await deactivateUnit(unit.id);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      message: 'Unit has pendencies that prevent its deactivation',
      error: 'Unprocessable Entity',
      statusCode: 422,
      pendencies: [{ type: 'FUTURE_APPOINTMENTS', count: 3 }],
    });
    expect((await findUnits())[0].active).toBe(true);
    expect(await patientListing()).toEqual([unit.id]);
  });

  it('with future appointments: responds 422 listing them', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id] });
    const { patient } = await insertPatient();
    const appointment = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: unit.id, startsAt: localTime(monday, '09:00') });

    const response = await deactivateUnit(unit.id);

    expect(response.statusCode).toBe(422);
    expect(response.json().pendencies).toEqual([
      { type: 'FUTURE_APPOINTMENTS', count: 1, appointments: [{ id: appointment.id, startsAt: appointment.startsAt.toISOString() }] },
    ]);
    expect((await findUnits())[0].active).toBe(true);
  });

  it('unit already inactive: responds 204 again', async () => {
    const unit = await insertUnit();

    expect((await deactivateUnit(unit.id)).statusCode).toBe(204);
    expect((await deactivateUnit(unit.id)).statusCode).toBe(204);
    expect((await findUnits())[0].active).toBe(false);
  });

  it('responds 404 for a unit that does not exist', async () => {
    expect((await deactivateUnit(randomUUID())).statusCode).toBe(404);
  });

  it.each(['PATIENT', 'PROFESSIONAL'] as const)('responds 403 for %s', async (role) => {
    const unit = await insertUnit();

    expect((await deactivateUnit(unit.id, role)).statusCode).toBe(403);
    expect((await findUnits())[0].active).toBe(true);
  });
});
