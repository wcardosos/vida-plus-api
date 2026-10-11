import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { clearUnits, clearUsers, insertProfessional, insertUnit, signToken, tokenFor } from './helpers';

const app = buildApp();

function list(token: string, query = '') {
  return app.inject({ method: 'GET', url: `/professionals${query}`, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await clearUnits();
  await clearUsers();
});

describe('GET /professionals', () => {
  it('patient filters by unit and specialty: only active linked professionals, without account data', async () => {
    const unit = await insertUnit({ name: 'Clínica Jardins', type: 'CLINIC' });
    const other = await insertUnit();
    const closed = await insertUnit({ active: false });
    const { professional: cardiologist } = await insertProfessional({
      name: 'Dra. Ana',
      specialty: 'Cardiologia',
      unitIds: [unit.id, closed.id],
      registration: { number: '100', state: 'PB' },
    });
    await insertProfessional({ name: 'Dr. Bruno', specialty: 'Cardiologia', unitIds: [other.id] });
    await insertProfessional({ name: 'Dr. Caio', specialty: 'Pediatria', unitIds: [unit.id] });
    await insertProfessional({ name: 'Dra. Dora', specialty: 'Cardiologia', unitIds: [unit.id], active: false });

    const response = await list(await tokenFor(app, 'PATIENT'), `?unitId=${unit.id}&specialty=cardio`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: cardiologist.id,
          name: 'Dra. Ana',
          category: 'PHYSICIAN',
          specialty: 'Cardiologia',
          registration: { council: 'CRM', number: '100', state: 'PB' },
          units: [{ id: unit.id, name: 'Clínica Jardins', type: 'CLINIC', active: true }],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(response.body).not.toMatch(/email|userId|"active":false/);
  });

  it('ignores includeInactive for a non-admin', async () => {
    const unit = await insertUnit();
    await insertProfessional({ unitIds: [unit.id], active: false });

    for (const role of ['PATIENT', 'PROFESSIONAL'] as const) {
      expect((await list(await tokenFor(app, role), '?includeInactive=true')).json().total).toBe(0);
    }
  });

  it('admin sees inactive professionals with their status when includeInactive is true', async () => {
    const unit = await insertUnit();
    const { user: activeUser } = await insertProfessional({ name: 'Ativa', unitIds: [unit.id] });
    const { user: inactiveUser } = await insertProfessional({ name: 'Inativa', unitIds: [unit.id], active: false });
    const token = await tokenFor(app, 'ADMIN');

    const response = await list(token, '?includeInactive=true');

    expect(response.json()).toMatchObject({
      total: 2,
      items: [
        { name: 'Ativa', email: activeUser.email, active: true },
        { name: 'Inativa', email: inactiveUser.email, active: false },
      ],
    });
    expect((await list(token)).json().total).toBe(1);
  });

  it('filters by category', async () => {
    const unit = await insertUnit();
    await insertProfessional({ unitIds: [unit.id], category: 'PHYSICIAN' });
    const { professional: nurse } = await insertProfessional({ unitIds: [unit.id], category: 'NURSE' });

    const response = await list(await tokenFor(app, 'PATIENT'), '?category=NURSE');

    expect(response.json()).toMatchObject({ total: 1, items: [{ id: nurse.id, category: 'NURSE', registration: { council: 'COREN' } }] });
  });

  it('paginates ordered by name', async () => {
    const unit = await insertUnit();
    for (const name of ['Carla', 'Ana', 'Bruno']) {
      await insertProfessional({ name, unitIds: [unit.id] });
    }

    const response = await list(await tokenFor(app, 'PATIENT'), '?page=2&pageSize=2');

    expect(response.json()).toMatchObject({ page: 2, pageSize: 2, total: 3, items: [{ name: 'Carla' }] });
  });

  it('responds 400 for an invalid unitId or category', async () => {
    const token = await tokenFor(app, 'PATIENT');

    expect((await list(token, '?unitId=abc')).statusCode).toBe(400);
    expect((await list(token, '?category=DENTIST')).statusCode).toBe(400);
  });
});

describe('GET /professionals/me', () => {
  it('returns the authenticated professional with the linked units name and type', async () => {
    const hospital = await insertUnit({ name: 'Hospital Centro', type: 'HOSPITAL' });
    const lab = await insertUnit({ name: 'Laboratório Campinas', type: 'LABORATORY' });
    const { professional, user } = await insertProfessional({ unitIds: [hospital.id, lab.id] });

    const response = await app.inject({ method: 'GET', url: '/professionals/me', headers: { authorization: `Bearer ${signToken(app, user)}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: professional.id,
      email: user.email,
      units: expect.arrayContaining([
        { id: hospital.id, name: 'Hospital Centro', type: 'HOSPITAL', active: true },
        { id: lab.id, name: 'Laboratório Campinas', type: 'LABORATORY', active: true },
      ]),
    });
  });

  it('responds 403 to a PATIENT and an ADMIN', async () => {
    for (const role of ['PATIENT', 'ADMIN'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/professionals/me',
        headers: { authorization: `Bearer ${await tokenFor(app, role)}` },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('responds 404 to a PROFESSIONAL user without a professional record', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/professionals/me',
      headers: { authorization: `Bearer ${await tokenFor(app, 'PROFESSIONAL')}` },
    });

    expect(response.statusCode).toBe(404);
  });
});
