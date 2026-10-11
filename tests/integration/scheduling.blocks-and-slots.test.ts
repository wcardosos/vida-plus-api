import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import {
  clearUnits,
  clearUsers,
  findAppointments,
  insertAppointment,
  insertAvailability,
  insertBlock,
  insertPatient,
  insertProfessional,
  insertUnit,
  signToken,
  tokenFor,
} from './helpers';
import { clock, localTime, monday, requester } from './scheduling-helpers';

const app = buildApp({ clock });
const request = requester(app);

async function setup() {
  const centro = await insertUnit({ name: 'Unidade Centro' });
  const { professional, user } = await insertProfessional({ unitIds: [centro.id] });
  const { patient } = await insertPatient({ name: 'Maria da Silva' });
  return { centro, professional, patient, token: signToken(app, user) };
}

function freeSlotsUrl(professionalId: string, from: string, to: string, extra = '') {
  return `/schedule/free-slots?professionalId=${professionalId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`;
}

function mondayUrl(professionalId: string, extra = '') {
  return freeSlotsUrl(professionalId, localTime(monday, '00:00').toISOString(), localTime('2026-10-13', '00:00').toISOString(), extra);
}

function localStarts(slots: { startsAt: string }[]) {
  return slots.map((slot) => new Date(new Date(slot.startsAt).getTime() - 3 * 3_600_000).toISOString().slice(11, 16));
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

describe('POST /schedule/blocks', () => {
  it('creates the block and lists the scheduled appointments in the period, which stay SCHEDULED', async () => {
    const { centro, professional, patient, token } = await setup();
    const first = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime('2026-10-20', '09:00') });
    const second = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime('2026-10-24', '10:00') });
    await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime('2026-10-21', '09:00'), status: 'CANCELED', cancellationReason: 'x' });
    await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime('2026-10-26', '09:00') });

    const response = await request('POST', '/schedule/blocks', token, {
      startsAt: '2026-10-20T03:00:00Z',
      endsAt: '2026-10-25T03:00:00Z',
      reason: 'Férias',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      block: { id: expect.any(String), startsAt: '2026-10-20T03:00:00.000Z', endsAt: '2026-10-25T03:00:00.000Z', reason: 'Férias' },
      affectedAppointments: [
        { id: first.id, startsAt: first.startsAt.toISOString(), endsAt: first.endsAt.toISOString(), patientName: 'Maria da Silva' },
        { id: second.id, startsAt: second.startsAt.toISOString(), endsAt: second.endsAt.toISOString(), patientName: 'Maria da Silva' },
      ],
    });
    expect((await findAppointments()).filter((row) => row.status === 'SCHEDULED')).toHaveLength(3);
  });

  it('responds 422 for an end before the start', async () => {
    const { token } = await setup();

    const response = await request('POST', '/schedule/blocks', token, { startsAt: '2026-10-25T03:00:00Z', endsAt: '2026-10-20T03:00:00Z', reason: 'Férias' });

    expect(response.statusCode).toBe(422);
  });

  it.each([{ reason: '  ' }, { startsAt: '2026-10-20' }, { reason: 'a'.repeat(201) }])('responds 400 for %j', async (overrides) => {
    const { token } = await setup();

    const response = await request('POST', '/schedule/blocks', token, {
      startsAt: '2026-10-20T03:00:00Z',
      endsAt: '2026-10-25T03:00:00Z',
      reason: 'Férias',
      ...overrides,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET and DELETE /schedule/blocks', () => {
  it('lists the own blocks overlapping the period and removes one', async () => {
    const { professional, token } = await setup();
    const { professional: other } = await insertProfessional({ unitIds: [(await insertUnit()).id] });
    const october = await insertBlock({ professionalId: professional.id, startsAt: localTime('2026-10-20', '00:00'), endsAt: localTime('2026-10-25', '00:00'), reason: 'Férias' });
    const november = await insertBlock({ professionalId: professional.id, startsAt: localTime('2026-11-02', '08:00'), endsAt: localTime('2026-11-02', '12:00'), reason: 'Congresso' });
    const foreign = await insertBlock({ professionalId: other.id, startsAt: localTime('2026-10-20', '00:00'), endsAt: localTime('2026-10-21', '00:00'), reason: 'x' });

    const all = await request('GET', '/schedule/blocks', token);
    const inPeriod = await request('GET', '/schedule/blocks?from=2026-10-24T00:00:00Z&to=2026-10-31T00:00:00Z', token);

    expect(all.json().map((item: { id: string }) => item.id)).toEqual([october.id, november.id]);
    expect(inPeriod.json()).toEqual([{ id: october.id, startsAt: october.startsAt.toISOString(), endsAt: october.endsAt.toISOString(), reason: 'Férias' }]);
    expect((await request('GET', '/schedule/blocks?from=2026-10-31T00:00:00Z&to=2026-10-24T00:00:00Z', token)).statusCode).toBe(400);

    expect((await request('DELETE', `/schedule/blocks/${foreign.id}`, token)).statusCode).toBe(404);
    expect((await request('DELETE', `/schedule/blocks/${randomUUID()}`, token)).statusCode).toBe(404);
    expect((await request('DELETE', `/schedule/blocks/${october.id}`, token)).statusCode).toBe(204);
    expect((await request('GET', '/schedule/blocks', token)).json().map((item: { id: string }) => item.id)).toEqual([november.id]);
  });
});

describe('GET /schedule/free-slots', () => {
  it('discounts scheduled appointments, and a canceled one frees its slot again', async () => {
    const { centro, professional, patient } = await setup();
    await insertAvailability({ professionalId: professional.id, unitId: centro.id, startTime: '08:00', endTime: '10:00' });
    const appointment = await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:30') });
    const token = await tokenFor(app, 'PATIENT');

    const response = await request('GET', mondayUrl(professional.id), token);

    expect(response.statusCode).toBe(200);
    expect(localStarts(response.json())).toEqual(['08:00', '09:00', '09:30']);
    expect(response.json()[0]).toEqual({
      startsAt: '2026-10-12T11:00:00.000Z',
      endsAt: '2026-10-12T11:30:00.000Z',
      unitId: centro.id,
      modality: 'IN_PERSON',
    });

    const patientToken = signToken(app, { id: patient.userId, role: 'PATIENT' });
    expect((await request('POST', `/appointments/${appointment.id}/cancel`, patientToken, { reason: 'Imprevisto' })).statusCode).toBe(200);

    expect(localStarts((await request('GET', mondayUrl(professional.id), token)).json())).toEqual(['08:00', '08:30', '09:00', '09:30']);
  });

  it('returns no slot inside a block', async () => {
    const { centro, professional } = await setup();
    for (const weekday of [1, 2, 3, 4, 5]) {
      await insertAvailability({ professionalId: professional.id, unitId: centro.id, weekday });
    }
    await insertBlock({ professionalId: professional.id, startsAt: localTime('2026-10-20', '00:00'), endsAt: localTime('2026-10-25', '00:00'), reason: 'Férias' });

    const response = await request('GET', freeSlotsUrl(professional.id, '2026-10-20T03:00:00Z', '2026-10-25T03:00:00Z'), await tokenFor(app, 'PATIENT'));
    const nextWeek = await request('GET', freeSlotsUrl(professional.id, '2026-10-19T03:00:00Z', '2026-10-20T03:00:00Z'), await tokenFor(app, 'PATIENT'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(nextWeek.json()).toHaveLength(8);
  });

  it('filters by modality and unit, and ignores inactive units', async () => {
    const centro = await insertUnit();
    const norte = await insertUnit();
    const closed = await insertUnit({ active: false });
    const { professional } = await insertProfessional({ unitIds: [centro.id, norte.id, closed.id] });
    await insertAvailability({ professionalId: professional.id, unitId: centro.id, startTime: '08:00', endTime: '09:00', slotMinutes: 60 });
    await insertAvailability({ professionalId: professional.id, unitId: norte.id, startTime: '10:00', endTime: '11:00', slotMinutes: 60, modality: 'TELECONSULTATION' });
    await insertAvailability({ professionalId: professional.id, unitId: closed.id, startTime: '14:00', endTime: '15:00', slotMinutes: 60 });
    const token = await tokenFor(app, 'PATIENT');

    const all = (await request('GET', mondayUrl(professional.id), token)).json();
    const tele = (await request('GET', mondayUrl(professional.id, '&modality=TELECONSULTATION'), token)).json();
    const centroOnly = (await request('GET', mondayUrl(professional.id, `&unitId=${centro.id}`), token)).json();

    expect(localStarts(all)).toEqual(['08:00', '10:00']);
    expect(tele).toEqual([expect.objectContaining({ unitId: norte.id, modality: 'TELECONSULTATION' })]);
    expect(localStarts(centroOnly)).toEqual(['08:00']);
  });

  it('removes slots that already started', async () => {
    const { centro, professional } = await setup();
    await insertAvailability({ professionalId: professional.id, unitId: centro.id, weekday: 7, startTime: '08:00', endTime: '10:00' });

    const response = await request('GET', freeSlotsUrl(professional.id, '2026-10-11T03:00:00Z', '2026-10-12T03:00:00Z'), await tokenFor(app, 'PATIENT'));

    expect(localStarts(response.json())).toEqual(['09:30']);
  });

  it('returns an empty list for an inactive professional', async () => {
    const centro = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [centro.id], active: false });
    await insertAvailability({ professionalId: professional.id, unitId: centro.id });

    const response = await request('GET', mondayUrl(professional.id), await tokenFor(app, 'PATIENT'));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('responds 404 for an unknown professional', async () => {
    expect((await request('GET', mondayUrl(randomUUID()), await tokenFor(app, 'PATIENT'))).statusCode).toBe(404);
  });

  it.each([
    ['a period of 40 days', '2026-10-12T03:00:00Z', '2026-11-21T03:00:00Z'],
    ['to before from', '2026-10-13T03:00:00Z', '2026-10-12T03:00:00Z'],
    ['a date without time', '2026-10-12', '2026-10-13'],
  ])('responds 400 for %s', async (_, from, to) => {
    const { professional } = await setup();

    expect((await request('GET', freeSlotsUrl(professional.id, from, to), await tokenFor(app, 'PATIENT'))).statusCode).toBe(400);
  });

  it('answers 31 days with 500 seeded appointments in under 2 seconds', async () => {
    const { centro, professional, patient } = await setup();
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      await insertAvailability({ professionalId: professional.id, unitId: centro.id, weekday, startTime: '06:00', endTime: '20:00', slotMinutes: 20 });
    }
    const start = localTime(monday, '06:00').getTime();
    for (let index = 0; index < 500; index += 1) {
      const day = Math.floor(index / 20);
      const startsAt = new Date(start + day * 86_400_000 + (index % 20) * 40 * 60_000);
      await insertAppointment({ patientId: patient.id, professionalId: professional.id, unitId: centro.id, startsAt, endsAt: new Date(startsAt.getTime() + 20 * 60_000) });
    }
    const token = await tokenFor(app, 'PATIENT');

    const startedAt = performance.now();
    const response = await request('GET', freeSlotsUrl(professional.id, '2026-10-12T03:00:00Z', '2026-11-12T03:00:00Z'), token);
    const elapsed = performance.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(31 * 42 - 500);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('GET /schedule/day', () => {
  it('lists the appointments of the day in order, filtered by unit, without other professionals', async () => {
    const centro = await insertUnit({ name: 'Unidade Centro' });
    const norte = await insertUnit({ name: 'Unidade Norte' });
    const { professional, user } = await insertProfessional({ name: 'Dra. Ana', unitIds: [centro.id, norte.id] });
    const { professional: other } = await insertProfessional({ unitIds: [centro.id] });
    const { patient: maria } = await insertPatient({ name: 'Maria' });
    const { patient: joao } = await insertPatient({ name: 'João' });
    const late = await insertAppointment({ patientId: joao.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '11:00') });
    const early = await insertAppointment({ patientId: maria.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime(monday, '08:00'), modality: 'TELECONSULTATION' });
    await insertAppointment({ patientId: maria.id, professionalId: professional.id, unitId: norte.id, startsAt: localTime(monday, '09:00') });
    await insertAppointment({ patientId: maria.id, professionalId: other.id, unitId: centro.id, startsAt: localTime(monday, '10:00') });
    await insertAppointment({ patientId: maria.id, professionalId: professional.id, unitId: centro.id, startsAt: localTime('2026-10-13', '08:00') });
    const token = signToken(app, user);

    const response = await request('GET', `/schedule/day?date=${monday}&unitId=${centro.id}`, token);

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { id: string }) => item.id)).toEqual([early.id, late.id]);
    expect(response.json()[0]).toMatchObject({
      startsAt: '2026-10-12T11:00:00.000Z',
      patient: { id: maria.id, name: 'Maria' },
      professional: { id: professional.id, name: 'Dra. Ana' },
      unit: { id: centro.id, name: 'Unidade Centro' },
      modality: 'TELECONSULTATION',
      status: 'SCHEDULED',
    });
    expect((await request('GET', `/schedule/day?date=${monday}`, token)).json()).toHaveLength(3);
  });

  it('responds 400 for an invalid date', async () => {
    const { token } = await setup();

    expect((await request('GET', '/schedule/day?date=12/10/2026', token)).statusCode).toBe(400);
  });
});
