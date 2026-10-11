import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { addressInput, clearUsers, findPatients, findUsers, insertPatient, insertUser, signToken, tokenFor } from './helpers';

const app = buildApp();

function getMe(token: string) {
  return app.inject({ method: 'GET', url: '/patients/me', headers: { authorization: `Bearer ${token}` } });
}

function patchMe(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PATCH', url: '/patients/me', payload, headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await clearUsers();
});

describe('GET /patients/me', () => {
  it('returns the authenticated patient', async () => {
    const { patient, user } = await insertPatient({ name: 'Maria da Silva' });

    const response = await getMe(signToken(app, user));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: patient.id, name: 'Maria da Silva', email: user.email, active: true });
  });

  it('responds 403 to a PROFESSIONAL', async () => {
    expect((await getMe(await tokenFor(app, 'PROFESSIONAL'))).statusCode).toBe(403);
  });

  it('responds 403 to an ADMIN', async () => {
    expect((await getMe(await tokenFor(app, 'ADMIN'))).statusCode).toBe(403);
  });

  it('responds 404 to a PATIENT user without a patient record', async () => {
    expect((await getMe(await tokenFor(app, 'PATIENT'))).statusCode).toBe(404);
  });

  it('responds 401 without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/patients/me' })).statusCode).toBe(401);
  });
});

describe('PATCH /patients/me', () => {
  it('changes name, phone, address and email', async () => {
    const { patient, user } = await insertPatient();

    const response = await patchMe(signToken(app, user), {
      name: 'Maria Souza',
      phone: '(83) 98888-7777',
      address: addressInput({ city: 'João Pessoa', zipCode: '58000-000' }),
      email: 'Maria.Souza@Exemplo.com',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: patient.id,
      name: 'Maria Souza',
      phone: '83988887777',
      address: { city: 'João Pessoa', zipCode: '58000000' },
      email: 'maria.souza@exemplo.com',
      cpf: patient.cpf.formatted(),
      birthDate: patient.birthDate,
    });
    const [row] = await findPatients();
    expect(row).toMatchObject({ name: 'Maria Souza', phone: '83988887777', addressCity: 'João Pessoa' });
    expect((await findUsers())[0].email).toBe('maria.souza@exemplo.com');
  });

  it('keeps the fields that were not sent', async () => {
    const { user } = await insertPatient({ name: 'Maria da Silva' });

    const response = await patchMe(signToken(app, user), { phone: '8333334444' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Maria da Silva', phone: '8333334444', email: user.email });
  });

  it.each([{ cpf: '111.444.777-35' }, { birthDate: '1991-01-01' }])('responds 400 when the body has %j', async (body) => {
    const { patient, user } = await insertPatient();

    const response = await patchMe(signToken(app, user), { name: 'Outra', ...body });

    expect(response.statusCode).toBe(400);
    expect((await findPatients())[0]).toMatchObject({ name: patient.name, cpf: patient.cpf.value, birthDate: patient.birthDate });
  });

  it('responds 400 for an empty body', async () => {
    const { user } = await insertPatient();

    expect((await patchMe(signToken(app, user), {})).statusCode).toBe(400);
  });

  it('email in use by another account: responds 409 and changes nothing', async () => {
    const { user } = await insertPatient({ name: 'Maria da Silva' });
    await insertUser({ email: 'taken@exemplo.com' });

    const response = await patchMe(signToken(app, user), { name: 'Maria Souza', email: 'taken@exemplo.com' });

    expect(response.statusCode).toBe(409);
    expect((await findPatients())[0].name).toBe('Maria da Silva');
    expect((await findUsers()).find((row) => row.id === user.id)?.email).toBe(user.email);
  });

  it('accepts its own current email', async () => {
    const { user } = await insertPatient();

    expect((await patchMe(signToken(app, user), { email: user.email.toUpperCase() })).statusCode).toBe(200);
  });

  it('responds 422 for an invalid phone', async () => {
    const { user } = await insertPatient();

    expect((await patchMe(signToken(app, user), { phone: '123' })).statusCode).toBe(422);
  });

  it('responds 403 to a PROFESSIONAL', async () => {
    expect((await patchMe(await tokenFor(app, 'PROFESSIONAL'), { name: 'X' })).statusCode).toBe(403);
  });
});
