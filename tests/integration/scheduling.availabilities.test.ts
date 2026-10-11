import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import type { Role } from '../../src/shared/roles';
import {
  clearUnits,
  clearUsers,
  findAppointments,
  findAvailabilities,
  insertAppointment,
  insertAvailability,
  insertPatient,
  insertProfessional,
  insertUnit,
  signToken,
  tokenFor,
} from './helpers';
import { clock, localTime, monday, requester, type Method } from './scheduling-helpers';

const app = buildApp({ clock });
const request = requester(app);

async function setup() {
  const centro = await insertUnit({ name: 'Unidade Centro' });
  const norte = await insertUnit({ name: 'Unidade Norte' });
  const { professional, user } = await insertProfessional({ unitIds: [centro.id, norte.id] });
  return { centro, norte, professional, token: signToken(app, user) };
}

function body(unitId: string, overrides: Record<string, unknown> = {}) {
  return { unitId, weekday: 1, startTime: '08:00', endTime: '12:00', slotMinutes: 30, modality: 'IN_PERSON', ...overrides };
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

describe('POST /schedule/availabilities', () => {
  it('creates an availability in a linked unit', async () => {
    const { centro, professional, token } = await setup();

    const response = await request('POST', '/schedule/availabilities', token, body(centro.id));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      professionalId: professional.id,
      unitId: centro.id,
      weekday: 1,
      startTime: '08:00',
      endTime: '12:00',
      slotMinutes: 30,
      modality: 'IN_PERSON',
    });
    expect(await findAvailabilities()).toMatchObject([{ id: response.json().id, startTime: '08:00:00', endTime: '12:00:00' }]);
  });

  it('responds 422 for a unit the professional is not linked to', async () => {
    const { token } = await setup();
    const other = await insertUnit();

    const response = await request('POST', '/schedule/availabilities', token, body(other.id));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Professional is not linked to this unit');
    expect(await findAvailabilities()).toHaveLength(0);
  });

  it('responds 422 for an inactive linked unit', async () => {
    const closed = await insertUnit({ active: false });
    const { user } = await insertProfessional({ unitIds: [closed.id] });

    const response = await request('POST', '/schedule/availabilities', signToken(app, user), body(closed.id));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Unit is inactive');
  });

  it.each([
    [{ startTime: '12:00', endTime: '08:00' }, 'endTime must be after startTime'],
    [{ startTime: '08:00', endTime: '08:20', slotMinutes: 30 }, 'slotMinutes must fit between startTime and endTime'],
    [{ slotMinutes: 241 }, 'slotMinutes must be between 5 and 240'],
    [{ weekday: 8 }, 'weekday must be between 1 (Monday) and 7 (Sunday)'],
    [{ endTime: '24:00' }, 'time must be between 00:00 and 23:59'],
  ])('responds 422 for %j', async (overrides, message) => {
    const { centro, token } = await setup();

    const response = await request('POST', '/schedule/availabilities', token, body(centro.id, overrides));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe(message);
  });

  it.each([{ startTime: '8h' }, { modality: 'HOME' }, { slotMinutes: '30' }, { unitId: 'x' }])('responds 400 for %j', async (overrides) => {
    const { centro, token } = await setup();

    expect((await request('POST', '/schedule/availabilities', token, body(centro.id, overrides))).statusCode).toBe(400);
  });

  it('responds 422 for an availability overlapping one in another unit', async () => {
    const { centro, norte, token } = await setup();
    expect((await request('POST', '/schedule/availabilities', token, body(centro.id))).statusCode).toBe(201);

    const response = await request(
      'POST',
      '/schedule/availabilities',
      token,
      body(norte.id, { startTime: '11:00', endTime: '14:00', modality: 'TELECONSULTATION' }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Availability overlaps another availability of the professional');
  });

  it('accepts an adjacent availability and one on another weekday', async () => {
    const { centro, norte, token } = await setup();
    await request('POST', '/schedule/availabilities', token, body(centro.id));

    expect((await request('POST', '/schedule/availabilities', token, body(norte.id, { startTime: '12:00', endTime: '14:00' }))).statusCode).toBe(
      201,
    );
    expect((await request('POST', '/schedule/availabilities', token, body(centro.id, { weekday: 2 }))).statusCode).toBe(201);
    expect(await findAvailabilities()).toHaveLength(3);
  });

  it('serializes concurrent overlapping availabilities so only one is created', async () => {
    const { centro, norte, token } = await setup();

    const responses = await Promise.all([
      request('POST', '/schedule/availabilities', token, body(centro.id)),
      request('POST', '/schedule/availabilities', token, body(norte.id, { startTime: '09:00', endTime: '13:00' })),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 422]);
    expect(await findAvailabilities()).toHaveLength(1);
  });
});

describe('GET /schedule/availabilities', () => {
  it('lists only the own availabilities ordered by weekday and time, filtered by unit', async () => {
    const { centro, norte, professional, token } = await setup();
    const tuesday = await insertAvailability({ professionalId: professional.id, unitId: centro.id, weekday: 2 });
    const mondayAfternoon = await insertAvailability({ professionalId: professional.id, unitId: norte.id, startTime: '13:00', endTime: '17:00' });
    const mondayMorning = await insertAvailability({ professionalId: professional.id, unitId: centro.id });
    const { professional: other } = await insertProfessional({ unitIds: [centro.id] });
    await insertAvailability({ professionalId: other.id, unitId: centro.id, weekday: 3 });

    const all = await request('GET', '/schedule/availabilities', token);
    const filtered = await request('GET', `/schedule/availabilities?unitId=${centro.id}`, token);

    expect(all.statusCode).toBe(200);
    expect(all.json().map((item: { id: string }) => item.id)).toEqual([mondayMorning.id, mondayAfternoon.id, tuesday.id]);
    expect(filtered.json().map((item: { id: string }) => item.id)).toEqual([mondayMorning.id, tuesday.id]);
  });
});

describe('PATCH /schedule/availabilities/:id', () => {
  it('changes the availability', async () => {
    const { centro, norte, professional, token } = await setup();
    const availability = await insertAvailability({ professionalId: professional.id, unitId: centro.id });

    const response = await request('PATCH', `/schedule/availabilities/${availability.id}`, token, {
      unitId: norte.id,
      endTime: '10:00',
      slotMinutes: 20,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ unitId: norte.id, startTime: '08:00', endTime: '10:00', slotMinutes: 20 });
    expect(await findAvailabilities()).toMatchObject([{ unitId: norte.id, endTime: '10:00:00', slotMinutes: 20 }]);
  });

  it('does not compare the availability with itself and still rejects overlaps with the others', async () => {
    const { centro, professional, token } = await setup();
    const availability = await insertAvailability({ professionalId: professional.id, unitId: centro.id });
    await insertAvailability({ professionalId: professional.id, unitId: centro.id, startTime: '13:00', endTime: '17:00' });

    expect((await request('PATCH', `/schedule/availabilities/${availability.id}`, token, { startTime: '07:00' })).statusCode).toBe(200);
    expect((await request('PATCH', `/schedule/availabilities/${availability.id}`, token, { endTime: '14:00' })).statusCode).toBe(422);
  });

  it('responds 422 when moving to an unlinked unit', async () => {
    const { centro, professional, token } = await setup();
    const availability = await insertAvailability({ professionalId: professional.id, unitId: centro.id });
    const other = await insertUnit();

    expect((await request('PATCH', `/schedule/availabilities/${availability.id}`, token, { unitId: other.id })).statusCode).toBe(422);
  });

  it('responds 400 for an empty body', async () => {
    const { centro, professional, token } = await setup();
    const availability = await insertAvailability({ professionalId: professional.id, unitId: centro.id });

    expect((await request('PATCH', `/schedule/availabilities/${availability.id}`, token, {})).statusCode).toBe(400);
  });
});

describe('DELETE /schedule/availabilities/:id', () => {
  it('removes the availability and keeps the appointments scheduled in it', async () => {
    const { centro, professional, token } = await setup();
    const availability = await insertAvailability({ professionalId: professional.id, unitId: centro.id });
    const { patient } = await insertPatient();
    await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:00') });

    const response = await request('DELETE', `/schedule/availabilities/${availability.id}`, token);

    expect(response.statusCode).toBe(204);
    expect(await findAvailabilities()).toHaveLength(0);
    expect(await findAppointments()).toMatchObject([{ status: 'SCHEDULED' }]);
  });
});

describe('availabilities of another professional', () => {
  it('responds 404 to change or remove them', async () => {
    const { centro, token } = await setup();
    const { professional: other } = await insertProfessional({ unitIds: [centro.id] });
    const availability = await insertAvailability({ professionalId: other.id, unitId: centro.id });

    expect((await request('PATCH', `/schedule/availabilities/${availability.id}`, token, { endTime: '10:00' })).statusCode).toBe(404);
    expect((await request('DELETE', `/schedule/availabilities/${availability.id}`, token)).statusCode).toBe(404);
    expect((await request('DELETE', `/schedule/availabilities/${randomUUID()}`, token)).statusCode).toBe(404);
    expect(await findAvailabilities()).toMatchObject([{ endTime: '12:00:00' }]);
  });
});

describe('unlinking a unit', () => {
  it('removes the availabilities of that unit in cascade', async () => {
    const { centro, norte, professional } = await setup();
    await insertAvailability({ professionalId: professional.id, unitId: centro.id });
    const kept = await insertAvailability({ professionalId: professional.id, unitId: norte.id, weekday: 2 });

    const response = await request('DELETE', `/professionals/${professional.id}/units/${centro.id}`, await tokenFor(app, 'ADMIN'));

    expect(response.statusCode).toBe(204);
    expect((await findAvailabilities()).map((row) => row.id)).toEqual([kept.id]);
  });
});

describe('access control', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const professionalRoutes: [Method, string, Record<string, unknown>?][] = [
    ['GET', '/schedule/availabilities'],
    ['POST', '/schedule/availabilities', body(id)],
    ['PATCH', `/schedule/availabilities/${id}`, { endTime: '10:00' }],
    ['DELETE', `/schedule/availabilities/${id}`],
    ['GET', '/schedule/blocks'],
    ['POST', '/schedule/blocks', { startsAt: '2026-10-20T03:00:00Z', endsAt: '2026-10-25T03:00:00Z', reason: 'Férias' }],
    ['DELETE', `/schedule/blocks/${id}`],
    ['GET', `/schedule/day?date=${monday}`],
  ];

  it.each(['PATIENT', 'ADMIN'] as Role[])('responds 403 to %s on every professional schedule route', async (role) => {
    const token = await tokenFor(app, role);

    for (const [method, url, payload] of professionalRoutes) {
      expect((await request(method, url, token, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('responds 401 without a token on every scheduling route', async () => {
    const routes: [Method, string, Record<string, unknown>?][] = [
      ...professionalRoutes,
      ['GET', `/schedule/free-slots?professionalId=${id}&from=2026-10-12T03:00:00Z&to=2026-10-13T03:00:00Z`],
      ['POST', '/appointments', { professionalId: id, unitId: id, modality: 'IN_PERSON', startsAt: '2026-10-12T11:00:00Z' }],
      ['GET', '/appointments'],
      ['GET', `/appointments/${id}`],
      ['POST', `/appointments/${id}/cancel`, { reason: 'x' }],
      ['POST', `/appointments/${id}/no-show`],
    ];

    for (const [method, url, payload] of routes) {
      expect((await request(method, url, undefined, payload)).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
