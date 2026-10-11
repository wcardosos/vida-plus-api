import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { env } from '../../src/env';
import { generateCpf, maskCpf } from '../fixtures/cpf';
import { addressInput, clearUsers, findConsents, findPatients, findUsers, insertPatient, insertUser, nextIp } from './helpers';

const app = buildApp();

function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Maria da Silva',
    cpf: '529.982.247-25',
    birthDate: '1990-04-12',
    phone: '83999990000',
    address: addressInput({ street: 'Rua A', number: '10', district: 'Centro', city: 'Guarabira', state: 'PB', zipCode: '58200000' }),
    email: 'maria@exemplo.com',
    password: 'a-strong-password',
    acceptTerms: true,
    teleconsultationConsent: true,
    ...overrides,
  };
}

function register(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/patients/register', payload: body, remoteAddress: nextIp() });
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
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

describe('POST /patients/register', () => {
  it('with teleconsultation consent: creates the user, the patient and the consent', async () => {
    const response = await register(registerBody());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      id: expect.any(String),
      userId: expect.any(String),
      name: 'Maria da Silva',
      cpf: '529.982.247-25',
      birthDate: '1990-04-12',
      phone: '83999990000',
      address: { street: 'Rua A', number: '10', complement: null, district: 'Centro', city: 'Guarabira', state: 'PB', zipCode: '58200000' },
      email: 'maria@exemplo.com',
      active: true,
      termsVersion: env.TERMS_VERSION,
      termsAcceptedAt: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(response.body).not.toMatch(/password/i);

    const [user] = await findUsers();
    expect(user).toMatchObject({ id: body.userId, email: 'maria@exemplo.com', role: 'PATIENT', active: true });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);

    const [patient] = await findPatients();
    expect(patient).toMatchObject({ id: body.id, userId: user.id, cpf: '52998224725', termsVersion: env.TERMS_VERSION });
    expect(patient.termsAcceptedAt).toBeInstanceOf(Date);

    const consents = await findConsents();
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ patientId: body.id, purpose: 'TELECONSULTATION', termsVersion: env.TERMS_VERSION, revokedAt: null });
  });

  it('lets the new patient log in with the chosen password', async () => {
    expect((await register(registerBody())).statusCode).toBe(201);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'maria@exemplo.com', password: 'a-strong-password' },
      remoteAddress: nextIp(),
    });

    expect(response.statusCode).toBe(200);
  });

  it('without teleconsultation consent: responds 201 and stores no consent', async () => {
    const response = await register(registerBody({ teleconsultationConsent: false }));

    expect(response.statusCode).toBe(201);
    expect(await findPatients()).toHaveLength(1);
    expect(await findConsents()).toHaveLength(0);
  });

  it('treats an absent teleconsultation consent as refused', async () => {
    const { teleconsultationConsent: _consent, ...body } = registerBody();

    expect((await register(body)).statusCode).toBe(201);
    expect(await findConsents()).toHaveLength(0);
  });

  it('terms of use refused: responds 422 and stores nothing', async () => {
    const response = await register(registerBody({ acceptTerms: false }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('The terms of use must be accepted');
    expect(await findUsers()).toHaveLength(0);
    expect(await findPatients()).toHaveLength(0);
    expect(await findConsents()).toHaveLength(0);
  });

  it.each([
    ['cpf', '111.111.111-11', 422],
    ['cpf', '529.982.247-26', 422],
    ['cpf', '123', 400],
    ['birthDate', daysFromNow(2), 422],
    ['birthDate', '12/04/1990', 400],
    ['email', 'sem-arroba', 400],
    ['password', 'short', 400],
    ['phone', '123', 422],
  ])('%s %j: responds %i pointing to the field', async (field, value, status) => {
    const response = await register(registerBody({ [field]: value }));

    expect(response.statusCode).toBe(status);
    const body = response.json();
    if (status === 400) {
      expect(body.details.map((detail: { path: string }) => detail.path)).toContain(`/${field}`);
    } else {
      expect(body.message).toMatch(new RegExp(`^${field} `));
    }
    expect(await findUsers()).toHaveLength(0);
  });

  it('responds 400 when acceptTerms is missing', async () => {
    const { acceptTerms: _accept, ...body } = registerBody();

    expect((await register(body)).statusCode).toBe(400);
  });

  it('CPF already registered: responds 409 and creates no user', async () => {
    const cpf = generateCpf();
    await insertPatient({ cpf });
    const usersBefore = await findUsers();

    const response = await register(registerBody({ cpf: maskCpf(cpf) }));

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('CPF is already registered');
    expect(await findUsers()).toHaveLength(usersBefore.length);
    expect(await findPatients()).toHaveLength(1);
    expect(await findConsents()).toHaveLength(0);
  });

  it('email already in use: responds 409 and creates no patient', async () => {
    await insertUser({ email: 'maria@exemplo.com', role: 'PROFESSIONAL' });

    const response = await register(registerBody({ email: 'MARIA@exemplo.com' }));

    expect(response.statusCode).toBe(409);
    expect(await findUsers()).toHaveLength(1);
    expect(await findPatients()).toHaveLength(0);
    expect(await findConsents()).toHaveLength(0);
  });

  it('does not require a token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/patients/register',
      payload: registerBody(),
      remoteAddress: nextIp(),
      headers: { authorization: 'Bearer invalid' },
    });

    expect(response.statusCode).toBe(201);
  });
});
