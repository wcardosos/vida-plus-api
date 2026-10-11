import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import type { Role } from '../../src/shared/roles';
import { clearUnits, clearUsers, insertUnit, tokenFor } from './helpers';

const app = buildApp();

async function listUnits(role: Role, query: Record<string, string | number> = {}) {
  return app.inject({
    method: 'GET',
    url: '/units',
    query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])),
    headers: { authorization: `Bearer ${await tokenFor(app, role)}` },
  });
}

async function getUnit(role: Role, id: string) {
  return app.inject({ method: 'GET', url: `/units/${id}`, headers: { authorization: `Bearer ${await tokenFor(app, role)}` } });
}

function names(body: { items: { name: string }[] }) {
  return body.items.map((item) => item.name);
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

describe('GET /units', () => {
  it('patient filters laboratories: returns the 2 active ones ordered by name with total 2', async () => {
    await insertUnit({ name: 'Laboratório Zeta', type: 'LABORATORY' });
    await insertUnit({ name: 'Laboratório Alfa', type: 'LABORATORY' });
    await insertUnit({ name: 'Laboratório Beta', type: 'LABORATORY', active: false });
    await insertUnit({ name: 'Clínica Centro', type: 'CLINIC' });

    const response = await listUnits('PATIENT', { type: 'LABORATORY' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(names(body)).toEqual(['Laboratório Alfa', 'Laboratório Zeta']);
    expect(body).toMatchObject({ total: 2, limit: 20, offset: 0 });
    expect(body.items[0]).toMatchObject({ type: 'LABORATORY', active: true, cnpj: expect.stringMatching(/^\w{2}\.\w{3}\.\w{3}\/\w{4}-\d{2}$/) });
  });

  it('administrator sees inactive units when filtering active=false', async () => {
    await insertUnit({ name: 'Ativa' });
    await insertUnit({ name: 'Inativa', active: false });

    const response = await listUnits('ADMIN', { active: 'false' });

    expect(response.statusCode).toBe(200);
    expect(names(response.json())).toEqual(['Inativa']);
    expect(response.json().total).toBe(1);
  });

  it('administrator sees active and inactive units without the filter', async () => {
    await insertUnit({ name: 'Ativa' });
    await insertUnit({ name: 'Inativa', active: false });

    expect(names((await listUnits('ADMIN')).json())).toEqual(['Ativa', 'Inativa']);
  });

  it('patient trying to see inactive units gets only active ones', async () => {
    await insertUnit({ name: 'Ativa' });
    await insertUnit({ name: 'Inativa', active: false });

    const response = await listUnits('PATIENT', { active: 'false' });

    expect(response.statusCode).toBe(200);
    expect(names(response.json())).toEqual(['Ativa']);
  });

  it('professional sees only active units', async () => {
    await insertUnit({ name: 'Ativa' });
    await insertUnit({ name: 'Inativa', active: false });

    expect(names((await listUnits('PROFESSIONAL')).json())).toEqual(['Ativa']);
  });

  it('paginates with limit and offset and reports the total', async () => {
    for (const name of ['Unidade A', 'Unidade B', 'Unidade C', 'Unidade D', 'Unidade E']) {
      await insertUnit({ name });
    }

    const response = await listUnits('PATIENT', { limit: 2, offset: 2 });

    expect(response.json()).toMatchObject({ total: 5, limit: 2, offset: 2 });
    expect(names(response.json())).toEqual(['Unidade C', 'Unidade D']);
  });

  it('searches by partial name ignoring case', async () => {
    await insertUnit({ name: 'Hospital São Lucas' });
    await insertUnit({ name: 'Clínica Lucas Prado' });
    await insertUnit({ name: 'Laboratório Central' });

    expect(names((await listUnits('PATIENT', { name: 'lucas' })).json())).toEqual(['Clínica Lucas Prado', 'Hospital São Lucas']);
  });

  it('treats LIKE wildcards in the name as literal characters', async () => {
    await insertUnit({ name: 'Clínica 100% Saúde' });
    await insertUnit({ name: 'Clínica Bem Estar' });

    expect(names((await listUnits('PATIENT', { name: '%' })).json())).toEqual(['Clínica 100% Saúde']);
    expect(names((await listUnits('PATIENT', { name: 'Cl_nica' })).json())).toEqual([]);
  });

  it('filters by city ignoring case and by state', async () => {
    await insertUnit({ name: 'Unidade Campinas', address: { city: 'Campinas', state: 'SP' } });
    await insertUnit({ name: 'Unidade Recife', address: { city: 'Recife', state: 'PE' } });
    await insertUnit({ name: 'Unidade Campinas Sul', address: { city: 'Campinas Sul', state: 'SP' } });

    expect(names((await listUnits('PATIENT', { city: 'CAMPINAS' })).json())).toEqual(['Unidade Campinas']);
    expect(names((await listUnits('PATIENT', { state: 'pe' })).json())).toEqual(['Unidade Recife']);
  });

  it.each<Record<string, string | number>>([{ limit: 101 }, { limit: 0 }, { offset: -1 }, { type: 'PHARMACY' }, { state: 'XX' }])(
    'responds 400 for the query %j',
    async (query) => {
      expect((await listUnits('PATIENT', query)).statusCode).toBe(400);
    },
  );

  it('responds 401 without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/units' })).statusCode).toBe(401);
  });
});

describe('GET /units/:id', () => {
  it('returns an active unit to any role', async () => {
    const unit = await insertUnit({ name: 'Clínica Centro', type: 'CLINIC' });

    for (const role of ['PATIENT', 'PROFESSIONAL', 'ADMIN'] as const) {
      const response = await getUnit(role, unit.id);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: unit.id, name: 'Clínica Centro', cnpj: unit.cnpj.formatted() });
    }
  });

  it('patient does not see an inactive unit: responds 404', async () => {
    const unit = await insertUnit({ active: false });

    const response = await getUnit('PATIENT', unit.id);

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe('Unit not found');
  });

  it('responds 404 to a professional for an inactive unit', async () => {
    const unit = await insertUnit({ active: false });

    expect((await getUnit('PROFESSIONAL', unit.id)).statusCode).toBe(404);
  });

  it('returns an inactive unit to an administrator', async () => {
    const unit = await insertUnit({ active: false });

    const response = await getUnit('ADMIN', unit.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().active).toBe(false);
  });

  it('responds 404 for a unit that does not exist', async () => {
    expect((await getUnit('ADMIN', randomUUID())).statusCode).toBe(404);
  });

  it('responds 400 for an id that is not a UUID', async () => {
    expect((await getUnit('ADMIN', 'not-a-uuid')).statusCode).toBe(400);
  });
});

describe('OpenAPI spec', () => {
  it('documents the units routes behind bearer auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(Object.keys(spec.paths['/units']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(spec.paths['/units/{id}']).sort()).toEqual(['get', 'patch']);
    expect(Object.keys(spec.paths['/units/{id}/deactivate'])).toEqual(['post']);
    for (const operation of [spec.paths['/units'].get, spec.paths['/units/{id}'].patch, spec.paths['/units/{id}/deactivate'].post]) {
      expect(operation.tags).toEqual(['units']);
      expect(operation.security).toEqual([{ bearerAuth: [] }]);
    }
    expect(spec.components.schemas.UnitType.enum).toEqual(['HOSPITAL', 'CLINIC', 'LABORATORY', 'HOME_CARE']);
    expect(spec.components.schemas.UnitDeactivationError.properties).toHaveProperty('pendencies');
  });
});
