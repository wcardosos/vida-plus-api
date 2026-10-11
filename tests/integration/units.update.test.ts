import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { addressInput, clearUnits, clearUsers, findUnits, insertUnit, tokenFor } from './helpers';

const app = buildApp();

async function updateUnit(id: string, body: Record<string, unknown>, token?: string) {
  token ??= await tokenFor(app, 'ADMIN');
  return app.inject({ method: 'PATCH', url: `/units/${id}`, payload: body, headers: { authorization: `Bearer ${token}` } });
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

describe('PATCH /units/:id', () => {
  it('changes the address: responds 200 with the new address and refreshes updated_at', async () => {
    const unit = await insertUnit({ name: 'Clínica Centro' });
    const [before] = await findUnits();

    const response = await updateUnit(unit.id, {
      address: addressInput({ street: 'Rua Barão de Jaguara', number: '123-A', city: 'Campinas', zipCode: '13015-001', complement: 'Sala 4' }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: unit.id,
      name: 'Clínica Centro',
      address: { street: 'Rua Barão de Jaguara', number: '123-A', complement: 'Sala 4', city: 'Campinas', state: 'SP', zipCode: '13015001' },
      active: true,
    });
    const [after] = await findUnits();
    expect(after).toMatchObject({ addressCity: 'Campinas', addressZipCode: '13015001' });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it('changes only the name and keeps the address', async () => {
    const unit = await insertUnit({ name: 'Clínica Centro' });

    const response = await updateUnit(unit.id, { name: '  Clínica Centro Norte  ' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Clínica Centro Norte', address: { city: 'São Paulo' } });
  });

  it('trying to change the type: responds 400 and nothing changes', async () => {
    const unit = await insertUnit({ name: 'Clínica Centro', type: 'CLINIC' });

    const response = await updateUnit(unit.id, { name: 'Laboratório Centro', type: 'LABORATORY' });

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.json())).toContain('type');
    const [row] = await findUnits();
    expect(row).toMatchObject({ name: 'Clínica Centro', type: 'CLINIC' });
  });

  it('responds 400 when trying to change the CNPJ', async () => {
    const unit = await insertUnit();

    expect((await updateUnit(unit.id, { cnpj: '11.222.333/0001-81' })).statusCode).toBe(400);
    expect((await findUnits())[0].cnpj).toBe(unit.cnpj.value);
  });

  it('responds 400 for an empty body', async () => {
    const unit = await insertUnit();

    expect((await updateUnit(unit.id, {})).statusCode).toBe(400);
  });

  it('inactive unit: responds 422', async () => {
    const unit = await insertUnit({ name: 'Clínica Antiga', active: false });

    const response = await updateUnit(unit.id, { name: 'Clínica Nova' });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Unit is inactive');
    expect((await findUnits())[0].name).toBe('Clínica Antiga');
  });

  it('responds 422 for an invalid address and keeps the unit unchanged', async () => {
    const unit = await insertUnit();

    const response = await updateUnit(unit.id, { address: addressInput({ zipCode: '1234' }) });

    expect(response.statusCode).toBe(422);
    expect((await findUnits())[0].addressZipCode).toBe('01310100');
  });

  it('responds 404 for a unit that does not exist', async () => {
    expect((await updateUnit(randomUUID(), { name: 'Clínica Nova' })).statusCode).toBe(404);
  });

  it('responds 403 for a role other than ADMIN', async () => {
    const unit = await insertUnit();

    expect((await updateUnit(unit.id, { name: 'Clínica Nova' }, await tokenFor(app, 'PROFESSIONAL'))).statusCode).toBe(403);
  });
});
