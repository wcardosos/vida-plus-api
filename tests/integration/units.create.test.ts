import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { Unit } from '../../src/modules/units/entities/unit.entity';
import { createUnitRepository } from '../../src/modules/units/repositories/unit.repository';
import { generateCnpj, maskCnpj } from '../fixtures/cnpj';
import { addressInput, clearUnits, clearUsers, findUnits, tokenFor } from './helpers';

const app = buildApp();

function unitBody(overrides: Record<string, unknown> = {}) {
  return { name: 'Clínica Vida Plus Paulista', type: 'CLINIC', cnpj: '11.222.333/0001-81', address: addressInput(), ...overrides };
}

async function createUnit(body: Record<string, unknown>, token?: string) {
  token ??= await tokenFor(app, 'ADMIN');
  return app.inject({ method: 'POST', url: '/units', payload: body, headers: { authorization: `Bearer ${token}` } });
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

describe('POST /units', () => {
  it('valid data: responds 201 with the active unit and stores the CNPJ unmasked', async () => {
    const response = await createUnit(unitBody({ address: addressInput({ complement: 'Bloco B' }) }));

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      id: expect.any(String),
      name: 'Clínica Vida Plus Paulista',
      type: 'CLINIC',
      cnpj: '11.222.333/0001-81',
      address: {
        street: 'Avenida Paulista',
        number: '1000',
        complement: 'Bloco B',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01310100',
      },
      active: true,
    });

    const [row] = await findUnits();
    expect(row).toMatchObject({ id: body.id, cnpj: '11222333000181', addressZipCode: '01310100', active: true });
  });

  it('alphanumeric CNPJ: responds 201', async () => {
    const response = await createUnit(unitBody({ cnpj: '12.ABC.345/01DE-35' }));

    expect(response.statusCode).toBe(201);
    expect(response.json().cnpj).toBe('12.ABC.345/01DE-35');
    expect((await findUnits())[0].cnpj).toBe('12ABC34501DE35');
  });

  it('CNPJ with a wrong check digit: responds 422 pointing to the cnpj field', async () => {
    const response = await createUnit(unitBody({ cnpj: '11.222.333/0001-82' }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toMatch(/^cnpj /);
    expect(await findUnits()).toHaveLength(0);
  });

  it('duplicate CNPJ: responds 409 when the same CNPJ is sent with a mask', async () => {
    expect((await createUnit(unitBody({ cnpj: '11222333000181' }))).statusCode).toBe(201);

    const response = await createUnit(unitBody({ name: 'Outra unidade', cnpj: '11.222.333/0001-81' }));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ message: 'CNPJ is already registered', statusCode: 409 });
    expect(await findUnits()).toHaveLength(1);
  });

  it('relies on the unique index when the pre-check is bypassed', async () => {
    const repository = createUnitRepository(db);
    const cnpj = generateCnpj();
    const props = { name: 'Unidade', type: 'CLINIC', cnpj, address: addressInput() } as const;
    await repository.insert(Unit.create(props));

    await expect(repository.insert(Unit.create({ ...props, cnpj: maskCnpj(cnpj) }))).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('nonexistent state: responds 422', async () => {
    const response = await createUnit(unitBody({ address: addressInput({ state: 'XX' }) }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toMatch(/^address\.state /);
  });

  it('responds 400 when a required field is missing', async () => {
    const { address: _address, ...body } = unitBody();

    const response = await createUnit(body);

    expect(response.statusCode).toBe(400);
  });

  it('responds 400 for an unknown type', async () => {
    expect((await createUnit(unitBody({ type: 'PHARMACY' }))).statusCode).toBe(400);
  });

  it('role without permission: responds 403 for PROFESSIONAL', async () => {
    const response = await createUnit(unitBody(), await tokenFor(app, 'PROFESSIONAL'));

    expect(response.statusCode).toBe(403);
    expect(await findUnits()).toHaveLength(0);
  });

  it('responds 403 for PATIENT', async () => {
    expect((await createUnit(unitBody(), await tokenFor(app, 'PATIENT'))).statusCode).toBe(403);
  });

  it('responds 401 without a token', async () => {
    const response = await app.inject({ method: 'POST', url: '/units', payload: unitBody() });

    expect(response.statusCode).toBe(401);
  });
});
