import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import type { Role } from '../../src/shared/roles';
import { clearUnits, clearUsers, findProfessionals, findProfessionalUnits, findUsers, insertProfessional, insertUnit, insertUser, signToken, tokenFor } from './helpers';

const app = buildApp();

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function request(method: Method, url: string, token?: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function adminToken() {
  return tokenFor(app, 'ADMIN');
}

async function linkedUnitIds(professionalId: string) {
  return (await findProfessionalUnits()).filter((link) => link.professionalId === professionalId).map((link) => link.unitId);
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

describe('GET /professionals/:id', () => {
  it('returns the professional with account data and units', async () => {
    const unit = await insertUnit({ name: 'Hospital Centro', type: 'HOSPITAL' });
    const { professional, user } = await insertProfessional({ unitIds: [unit.id] });

    const response = await request('GET', `/professionals/${professional.id}`, await adminToken());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: professional.id,
      email: user.email,
      active: true,
      units: [{ id: unit.id, name: 'Hospital Centro', type: 'HOSPITAL' }],
    });
  });

  it('responds 404 for an unknown professional', async () => {
    expect((await request('GET', `/professionals/${randomUUID()}`, await adminToken())).statusCode).toBe(404);
  });
});

describe('PATCH /professionals/:id', () => {
  it('changes name, email, specialty and registration', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id] });

    const response = await request('PATCH', `/professionals/${professional.id}`, await adminToken(), {
      name: 'Ana Lima Souza',
      email: 'ana.souza@vidaplus.com',
      specialty: 'Pediatria',
      registration: { council: 'CRM', number: '54321', state: 'RN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'Ana Lima Souza',
      email: 'ana.souza@vidaplus.com',
      specialty: 'Pediatria',
      registration: { council: 'CRM', number: '54321', state: 'RN' },
    });
    expect((await findProfessionals())[0]).toMatchObject({ registrationNumber: '54321', registrationState: 'RN' });
  });

  it('clears the specialty with null', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id], specialty: 'Cardiologia' });

    const response = await request('PATCH', `/professionals/${professional.id}`, await adminToken(), { specialty: null });

    expect(response.json().specialty).toBeNull();
  });

  it('responds 409 for a registration already in use', async () => {
    const unit = await insertUnit();
    await insertProfessional({ unitIds: [unit.id], registration: { number: '111', state: 'PB' } });
    const { professional } = await insertProfessional({ unitIds: [unit.id] });

    const response = await request('PATCH', `/professionals/${professional.id}`, await adminToken(), {
      registration: { council: 'CRM', number: '111', state: 'PB' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('responds 422 when the new category does not match the current council', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id], category: 'NURSE' });

    expect((await request('PATCH', `/professionals/${professional.id}`, await adminToken(), { category: 'PHYSICIAN' })).statusCode).toBe(422);
    expect((await findProfessionals())[0].category).toBe('NURSE');
  });

  it('responds 400 for an empty body or an unknown field', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id] });
    const token = await adminToken();

    expect((await request('PATCH', `/professionals/${professional.id}`, token, {})).statusCode).toBe(400);
    expect((await request('PATCH', `/professionals/${professional.id}`, token, { unitIds: [unit.id] })).statusCode).toBe(400);
  });

  it('responds 404 for an unknown professional', async () => {
    expect((await request('PATCH', `/professionals/${randomUUID()}`, await adminToken(), { name: 'X' })).statusCode).toBe(404);
  });
});

describe('POST /professionals/:id/units', () => {
  it('links an active unit not yet linked', async () => {
    const first = await insertUnit();
    const second = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [first.id] });

    const response = await request('POST', `/professionals/${professional.id}/units`, await adminToken(), { unitId: second.id });

    expect(response.statusCode).toBe(204);
    expect((await linkedUnitIds(professional.id)).sort()).toEqual([first.id, second.id].sort());
  });

  it('responds 409 for a unit already linked', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id] });

    expect((await request('POST', `/professionals/${professional.id}/units`, await adminToken(), { unitId: unit.id })).statusCode).toBe(409);
  });

  it('responds 422 for an inactive or nonexistent unit', async () => {
    const unit = await insertUnit();
    const inactive = await insertUnit({ active: false });
    const { professional } = await insertProfessional({ unitIds: [unit.id] });
    const token = await adminToken();

    expect((await request('POST', `/professionals/${professional.id}/units`, token, { unitId: inactive.id })).statusCode).toBe(422);
    expect((await request('POST', `/professionals/${professional.id}/units`, token, { unitId: randomUUID() })).statusCode).toBe(422);
    expect(await linkedUnitIds(professional.id)).toEqual([unit.id]);
  });

  it('responds 404 for an unknown professional', async () => {
    const unit = await insertUnit();

    expect((await request('POST', `/professionals/${randomUUID()}/units`, await adminToken(), { unitId: unit.id })).statusCode).toBe(404);
  });
});

describe('DELETE /professionals/:id/units/:unitId', () => {
  it('unlinks one of several units', async () => {
    const first = await insertUnit();
    const second = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [first.id, second.id] });

    const response = await request('DELETE', `/professionals/${professional.id}/units/${first.id}`, await adminToken());

    expect(response.statusCode).toBe(204);
    expect(await linkedUnitIds(professional.id)).toEqual([second.id]);
  });

  it('responds 422 when unlinking the last unit', async () => {
    const unit = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id] });

    const response = await request('DELETE', `/professionals/${professional.id}/units/${unit.id}`, await adminToken());

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Professional must be linked to at least one unit');
    expect(await linkedUnitIds(professional.id)).toEqual([unit.id]);
  });

  it('responds 404 for a unit that is not linked or an unknown professional', async () => {
    const unit = await insertUnit();
    const other = await insertUnit();
    const { professional } = await insertProfessional({ unitIds: [unit.id, other.id] });
    const token = await adminToken();

    expect((await request('DELETE', `/professionals/${professional.id}/units/${randomUUID()}`, token)).statusCode).toBe(404);
    expect((await request('DELETE', `/professionals/${randomUUID()}/units/${unit.id}`, token)).statusCode).toBe(404);
  });
});

describe('POST /professionals/:id/deactivate and /activate', () => {
  it('deactivates the account and keeps the unit links', async () => {
    const unit = await insertUnit();
    const { professional, user } = await insertProfessional({ unitIds: [unit.id] });

    const response = await request('POST', `/professionals/${professional.id}/deactivate`, await adminToken());

    expect(response.statusCode).toBe(204);
    expect((await findUsers()).find((row) => row.id === user.id)?.active).toBe(false);
    expect(await findProfessionals()).toHaveLength(1);
    expect(await linkedUnitIds(professional.id)).toEqual([unit.id]);
    expect((await request('GET', '/professionals/me', signToken(app, user))).statusCode).toBe(401);
  });

  it('is idempotent in both directions', async () => {
    const unit = await insertUnit();
    const { professional, user } = await insertProfessional({ unitIds: [unit.id] });
    const token = await adminToken();

    for (const action of ['deactivate', 'deactivate', 'activate', 'activate']) {
      expect((await request('POST', `/professionals/${professional.id}/${action}`, token)).statusCode).toBe(204);
    }
    expect((await findUsers()).find((row) => row.id === user.id)?.active).toBe(true);
  });

  it('responds 404 for an unknown professional', async () => {
    const token = await adminToken();

    expect((await request('POST', `/professionals/${randomUUID()}/deactivate`, token)).statusCode).toBe(404);
    expect((await request('POST', `/professionals/${randomUUID()}/activate`, token)).statusCode).toBe(404);
  });

  it.todo('responds 422 listing the future appointments when deactivating or unlinking the unit of a scheduled appointment');
});

describe('access control', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const unitId = '22222222-2222-4222-8222-222222222222';
  const adminRoutes: [Method, string, Record<string, unknown>?][] = [
    ['GET', `/professionals/${id}`],
    ['PATCH', `/professionals/${id}`, { name: 'X' }],
    ['POST', `/professionals/${id}/units`, { unitId }],
    ['DELETE', `/professionals/${id}/units/${unitId}`],
    ['POST', `/professionals/${id}/deactivate`],
    ['POST', `/professionals/${id}/activate`],
  ];

  it.each(['PATIENT', 'PROFESSIONAL'] as Role[])('responds 403 to %s on every admin route', async (role) => {
    const token = signToken(app, await insertUser({ role }));

    for (const [method, url, payload] of adminRoutes) {
      expect((await request(method, url, token, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('responds 401 without a token on every route', async () => {
    const routes: [Method, string, Record<string, unknown>?][] = [...adminRoutes, ['GET', '/professionals'], ['GET', '/professionals/me']];

    for (const [method, url, payload] of routes) {
      expect((await request(method, url, undefined, payload)).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
