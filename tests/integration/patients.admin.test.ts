import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import { env } from '../../src/env';
import type { Role } from '../../src/shared/roles';
import { generateCpf, maskCpf } from '../fixtures/cpf';
import {
  addressInput,
  captureEmails,
  clearAuditLogs,
  clearUsers,
  findAuditLogs,
  findConsents,
  findPasswordResetTokens,
  findPatients,
  findUsers,
  insertPatient,
  insertUser,
  nextIp,
  signToken,
  tokenFor,
} from './helpers';

const emails = captureEmails();
const app = buildApp({ emailSender: emails.sender });

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

function request(method: Method, url: string, token?: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

async function adminToken() {
  return tokenFor(app, 'ADMIN');
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'João Pereira',
    cpf: '111.444.777-35',
    birthDate: '1985-09-30',
    phone: '8332710000',
    address: addressInput(),
    email: 'joao@exemplo.com',
    acceptTerms: true,
    ...overrides,
  };
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
  await clearAuditLogs();
  emails.sent.length = 0;
});

describe('GET /patients', () => {
  it('finds a patient by partial name ignoring case and by CPF with or without mask', async () => {
    const cpf = generateCpf();
    const { patient } = await insertPatient({ name: 'Maria da Silva', cpf });
    await insertPatient({ name: 'José Santos' });
    const token = await adminToken();

    for (const search of ['silva', 'MARIA DA', maskCpf(cpf), cpf, cpf.slice(0, 6)]) {
      const response = await request('GET', `/patients?search=${encodeURIComponent(search)}`, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ total: 1, page: 1, pageSize: 20, items: [{ id: patient.id, active: true }] });
    }
  });

  it('paginates ordered by name and reports the total', async () => {
    await insertPatient({ name: 'Carla' });
    await insertPatient({ name: 'Ana' });
    await insertPatient({ name: 'Bruno' });

    const response = await request('GET', '/patients?page=2&pageSize=2', await adminToken());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 2, pageSize: 2, total: 3, items: [{ name: 'Carla' }] });
  });

  it('filters by account status', async () => {
    await insertPatient({ name: 'Ativa' });
    const { patient: inactive } = await insertPatient({ name: 'Inativa', active: false });

    const response = await request('GET', '/patients?active=false', await adminToken());

    expect(response.json()).toMatchObject({ total: 1, items: [{ id: inactive.id, active: false }] });
  });

  it('treats LIKE wildcards in the search as literals', async () => {
    await insertPatient({ name: 'Maria' });

    expect((await request('GET', '/patients?search=%25', await adminToken())).json().total).toBe(0);
  });

  it('rejects a page size above 100', async () => {
    expect((await request('GET', '/patients?pageSize=101', await adminToken())).statusCode).toBe(400);
  });
});

describe('GET /patients/:id', () => {
  it('returns the patient with the account email and status', async () => {
    const { patient, user } = await insertPatient({ active: false });

    const response = await request('GET', `/patients/${patient.id}`, await adminToken());

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: patient.id, email: user.email, active: false });
  });

  it('responds 404 for an unknown patient', async () => {
    expect((await request('GET', `/patients/${randomUUID()}`, await adminToken())).statusCode).toBe(404);
  });
});

describe('POST /patients', () => {
  it('creates user and patient and emails a password setup link', async () => {
    const response = await request('POST', '/patients', await adminToken(), createBody());

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: 'João Pereira', cpf: '111.444.777-35', email: 'joao@exemplo.com', active: true });
    expect(response.body).not.toMatch(/password/i);

    const user = (await findUsers()).find((row) => row.id === body.userId);
    expect(user).toMatchObject({ role: 'PATIENT', active: true });
    expect(await findPatients()).toHaveLength(1);
    expect(await findConsents()).toHaveLength(0);

    const tokens = await findPasswordResetTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].userId).toBe(body.userId);
    expect(tokens[0].expiresAt.getTime() - tokens[0].createdAt.getTime()).toBe(env.PASSWORD_SETUP_TOKEN_TTL);

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]).toMatchObject({ to: 'joao@exemplo.com', subject: 'Welcome to Vida Plus: set your password' });
  });

  it('lets the patient set the password from the emailed link and log in', async () => {
    expect((await request('POST', '/patients', await adminToken(), createBody())).statusCode).toBe(201);
    const link = new URL(/https?:\/\/\S+/.exec(emails.sent[0].text)![0]);

    const reset = await app.inject({
      method: 'POST',
      url: '/auth/password/reset',
      payload: { token: link.searchParams.get('token'), password: 'chosen-password' },
    });
    expect(reset.statusCode).toBe(204);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@exemplo.com', password: 'chosen-password' },
      remoteAddress: nextIp(),
    });
    expect(login.statusCode).toBe(200);
  });

  it('ignores a password sent by the administrator', async () => {
    const response = await request('POST', '/patients', await adminToken(), createBody({ password: 'admin-chosen-password' }));

    expect(response.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@exemplo.com', password: 'admin-chosen-password' },
      remoteAddress: nextIp(),
    });
    expect(login.statusCode).toBe(401);
  });

  it('responds 422 when the terms were not accepted and stores nothing', async () => {
    const token = await adminToken();
    const usersBefore = (await findUsers()).length;

    const response = await request('POST', '/patients', token, createBody({ acceptTerms: false }));

    expect(response.statusCode).toBe(422);
    expect(await findUsers()).toHaveLength(usersBefore);
    expect(emails.sent).toHaveLength(0);
  });

  it('responds 409 for a CPF already registered', async () => {
    await insertPatient({ cpf: '11144477735' });

    expect((await request('POST', '/patients', await adminToken(), createBody())).statusCode).toBe(409);
    expect(emails.sent).toHaveLength(0);
  });
});

describe('PATCH /patients/:id', () => {
  it('changes the contact data', async () => {
    const { patient } = await insertPatient();

    const response = await request('PATCH', `/patients/${patient.id}`, await adminToken(), { name: 'Nome Novo', email: 'novo@exemplo.com' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Nome Novo', email: 'novo@exemplo.com' });
  });

  it('responds 400 when CPF is sent', async () => {
    const { patient } = await insertPatient();

    expect((await request('PATCH', `/patients/${patient.id}`, await adminToken(), { cpf: '111.444.777-35' })).statusCode).toBe(400);
  });

  it('responds 404 for an unknown patient', async () => {
    expect((await request('PATCH', `/patients/${randomUUID()}`, await adminToken(), { name: 'X' })).statusCode).toBe(404);
  });

  it('responds 409 for an email in use', async () => {
    const { patient } = await insertPatient();
    await insertUser({ email: 'taken@exemplo.com' });

    expect((await request('PATCH', `/patients/${patient.id}`, await adminToken(), { email: 'taken@exemplo.com' })).statusCode).toBe(409);
  });
});

describe('PATCH /patients/:id/identity', () => {
  it('corrects CPF and birth date and records it in the audit trail', async () => {
    const { patient } = await insertPatient();
    const admin = await insertUser({ role: 'ADMIN' });

    const response = await app.inject({
      method: 'PATCH',
      url: `/patients/${patient.id}/identity`,
      payload: { cpf: '111.444.777-35', birthDate: '1990-04-21' },
      headers: { authorization: `Bearer ${signToken(app, admin)}` },
      remoteAddress: '203.0.113.9',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cpf: '111.444.777-35', birthDate: '1990-04-21' });
    expect((await findPatients())[0]).toMatchObject({ cpf: '11144477735', birthDate: '1990-04-21' });

    const logs = await findAuditLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      userId: admin.id,
      action: 'CORRECT',
      resourceType: 'PATIENT',
      resourceId: patient.id,
      patientId: patient.id,
      ip: '203.0.113.9',
    });
  });

  it('responds 409 when the CPF belongs to another patient', async () => {
    const other = generateCpf();
    await insertPatient({ cpf: other });
    const { patient } = await insertPatient();

    const response = await request('PATCH', `/patients/${patient.id}/identity`, await adminToken(), { cpf: maskCpf(other) });

    expect(response.statusCode).toBe(409);
    expect(await findAuditLogs()).toHaveLength(0);
  });

  it('accepts the CPF the patient already has', async () => {
    const { patient } = await insertPatient();

    const response = await request('PATCH', `/patients/${patient.id}/identity`, await adminToken(), { cpf: patient.cpf.formatted() });

    expect(response.statusCode).toBe(200);
  });

  it('responds 422 for an invalid CPF or a future birth date', async () => {
    const { patient } = await insertPatient();
    const token = await adminToken();

    expect((await request('PATCH', `/patients/${patient.id}/identity`, token, { cpf: '111.444.777-36' })).statusCode).toBe(422);
    expect((await request('PATCH', `/patients/${patient.id}/identity`, token, { birthDate: '2999-01-01' })).statusCode).toBe(422);
    expect(await findAuditLogs()).toHaveLength(0);
  });

  it('responds 400 for an empty body', async () => {
    const { patient } = await insertPatient();

    expect((await request('PATCH', `/patients/${patient.id}/identity`, await adminToken(), {})).statusCode).toBe(400);
  });

  it('responds 404 for an unknown patient', async () => {
    expect((await request('PATCH', `/patients/${randomUUID()}/identity`, await adminToken(), { birthDate: '1990-01-01' })).statusCode).toBe(404);
  });
});

describe('POST /patients/:id/deactivate and /activate', () => {
  it('deactivates the account, keeps the patient and refuses the login', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/patients/register',
      remoteAddress: nextIp(),
      payload: { ...createBody(), password: 'a-strong-password', teleconsultationConsent: false },
    });
    const patientId = registration.json().id;

    const response = await request('POST', `/patients/${patientId}/deactivate`, await adminToken());

    expect(response.statusCode).toBe(204);
    expect((await findUsers()).find((row) => row.email === 'joao@exemplo.com')?.active).toBe(false);
    expect(await findPatients()).toHaveLength(1);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'joao@exemplo.com', password: 'a-strong-password' },
      remoteAddress: nextIp(),
    });
    expect(login.statusCode).toBe(422);
    expect(login.json().message).toBe('User account is inactive');
  });

  it('rejects the tokens the patient already had', async () => {
    const { patient, user } = await insertPatient();
    const patientToken = signToken(app, user);

    await request('POST', `/patients/${patient.id}/deactivate`, await adminToken());

    expect((await request('GET', '/patients/me', patientToken)).statusCode).toBe(401);
  });

  it('is idempotent and audits only the actual changes', async () => {
    const { patient } = await insertPatient();
    const token = await adminToken();

    expect((await request('POST', `/patients/${patient.id}/deactivate`, token)).statusCode).toBe(204);
    expect((await request('POST', `/patients/${patient.id}/deactivate`, token)).statusCode).toBe(204);
    expect((await request('POST', `/patients/${patient.id}/activate`, token)).statusCode).toBe(204);
    expect((await request('POST', `/patients/${patient.id}/activate`, token)).statusCode).toBe(204);

    const user = (await findUsers()).find((row) => row.id === patient.userId);
    expect(user?.active).toBe(true);
    const logs = await findAuditLogs();
    expect(logs.map((log) => log.action)).toEqual(['UPDATE', 'UPDATE']);
    expect(logs.every((log) => log.patientId === patient.id)).toBe(true);
  });

  it('responds 404 for an unknown patient', async () => {
    const token = await adminToken();

    expect((await request('POST', `/patients/${randomUUID()}/deactivate`, token)).statusCode).toBe(404);
    expect((await request('POST', `/patients/${randomUUID()}/activate`, token)).statusCode).toBe(404);
  });
});

describe('DELETE /patients/:id', () => {
  it('does not exist', async () => {
    const { patient } = await insertPatient();

    expect((await request('DELETE', `/patients/${patient.id}`, await adminToken())).statusCode).toBe(404);
    expect(await findPatients()).toHaveLength(1);
  });
});

describe('access control', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const adminRoutes: [Method, string, Record<string, unknown>?][] = [
    ['GET', '/patients'],
    ['GET', `/patients/${id}`],
    ['POST', '/patients', createBody()],
    ['PATCH', `/patients/${id}`, { name: 'X' }],
    ['PATCH', `/patients/${id}/identity`, { birthDate: '1990-01-01' }],
    ['POST', `/patients/${id}/deactivate`],
    ['POST', `/patients/${id}/activate`],
  ];

  it.each(['PATIENT', 'PROFESSIONAL'] as Role[])('responds 403 to %s on every admin route', async (role) => {
    const token = await tokenFor(app, role);

    for (const [method, url, payload] of adminRoutes) {
      expect((await request(method, url, token, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('responds 401 without a token on every route except the self registration', async () => {
    const routes: [Method, string, Record<string, unknown>?][] = [...adminRoutes, ['GET', '/patients/me'], ['PATCH', '/patients/me', { name: 'X' }]];

    for (const [method, url, payload] of routes) {
      expect((await request(method, url, undefined, payload)).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
