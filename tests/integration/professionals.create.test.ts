import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { Professional } from '../../src/modules/professionals/entities/professional.entity';
import { createProfessionalRepository } from '../../src/modules/professionals/repositories/professional.repository';
import {
  captureEmails,
  clearUnits,
  clearUsers,
  findPasswordResetTokens,
  findProfessionals,
  findProfessionalUnits,
  findUsers,
  insertUnit,
  insertUser,
  tokenFor,
} from './helpers';

const emails = captureEmails();
const app = buildApp({ emailSender: emails.sender });

function professionalBody(unitIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    name: 'Dra. Ana Lima',
    email: 'ana.lima@vidaplus.com',
    category: 'PHYSICIAN',
    registration: { council: 'CRM', number: '12345', state: 'PB' },
    specialty: 'Cardiologia',
    unitIds,
    ...overrides,
  };
}

async function create(body: Record<string, unknown>, token?: string) {
  token ??= await tokenFor(app, 'ADMIN');
  return app.inject({ method: 'POST', url: '/professionals', payload: body, headers: { authorization: `Bearer ${token}` } });
}

async function professionalUsers() {
  return (await findUsers()).filter((user) => user.role === 'PROFESSIONAL');
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
  emails.sent.length = 0;
});

describe('POST /professionals', () => {
  it('physician in two units: creates the user, the professional and both links, and emails a setup link', async () => {
    const hospital = await insertUnit({ name: 'Hospital Centro', type: 'HOSPITAL' });
    const clinic = await insertUnit({ name: 'Clínica Jardins', type: 'CLINIC' });

    const response = await create(professionalBody([hospital.id, clinic.id]));

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      id: expect.any(String),
      userId: expect.any(String),
      name: 'Dra. Ana Lima',
      email: 'ana.lima@vidaplus.com',
      active: true,
      category: 'PHYSICIAN',
      specialty: 'Cardiologia',
      registration: { council: 'CRM', number: '12345', state: 'PB' },
      units: expect.arrayContaining([
        { id: hospital.id, name: 'Hospital Centro', type: 'HOSPITAL', active: true },
        { id: clinic.id, name: 'Clínica Jardins', type: 'CLINIC', active: true },
      ]),
      createdAt: expect.any(String),
    });
    expect(response.body).not.toMatch(/password/i);

    const [user] = await professionalUsers();
    expect(user).toMatchObject({ id: body.userId, active: true });
    expect(await findProfessionals()).toHaveLength(1);
    expect((await findProfessionalUnits()).map((link) => link.unitId).sort()).toEqual([hospital.id, clinic.id].sort());

    expect((await findPasswordResetTokens()).map((token) => token.userId)).toEqual([user.id]);
    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0].to).toBe('ana.lima@vidaplus.com');
  });

  it('duplicate registration in the same state: responds 409', async () => {
    const unit = await insertUnit();
    expect((await create(professionalBody([unit.id]))).statusCode).toBe(201);

    const response = await create(professionalBody([unit.id], { email: 'outro@vidaplus.com', registration: { council: 'crm', number: '12345', state: 'pb' } }));

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe('Council registration is already in use');
    expect(await professionalUsers()).toHaveLength(1);
  });

  it('same number in another state: responds 201', async () => {
    const unit = await insertUnit();
    expect((await create(professionalBody([unit.id]))).statusCode).toBe(201);

    const response = await create(professionalBody([unit.id], { email: 'outro@vidaplus.com', registration: { council: 'CRM', number: '12345', state: 'PE' } }));

    expect(response.statusCode).toBe(201);
  });

  it('relies on the unique index when the pre-check is bypassed', async () => {
    const unit = await insertUnit();
    const repository = createProfessionalRepository(db);
    const props = { name: 'A', category: 'NURSE', registration: { council: 'COREN', number: '777', state: 'SP' }, unitIds: [unit.id] } as const;
    await repository.insert(Professional.create({ ...props, userId: (await insertUser({ role: 'PROFESSIONAL' })).id }));

    await expect(
      repository.insert(Professional.create({ ...props, userId: (await insertUser({ role: 'PROFESSIONAL' })).id })),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('council incompatible with the category: responds 422 and creates no user', async () => {
    const unit = await insertUnit();

    const response = await create(professionalBody([unit.id], { category: 'NURSE' }));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('registration.council must be COREN for category NURSE');
    expect(await professionalUsers()).toHaveLength(0);
  });

  it('responds 400 for an empty unit list', async () => {
    expect((await create(professionalBody([]))).statusCode).toBe(400);
  });

  it('nonexistent unit: responds 422 and stores nothing', async () => {
    const unit = await insertUnit();

    const response = await create(professionalBody([unit.id, randomUUID()]));

    expect(response.statusCode).toBe(422);
    expect(await professionalUsers()).toHaveLength(0);
    expect(await findProfessionals()).toHaveLength(0);
    expect(emails.sent).toHaveLength(0);
  });

  it('inactive unit: responds 422 and creates no user', async () => {
    const active = await insertUnit();
    const inactive = await insertUnit({ active: false });

    const response = await create(professionalBody([active.id, inactive.id]));

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Unit is inactive');
    expect(await professionalUsers()).toHaveLength(0);
  });

  it('responds 409 for an email in use', async () => {
    const unit = await insertUnit();
    await insertUser({ email: 'ana.lima@vidaplus.com' });

    expect((await create(professionalBody([unit.id]))).statusCode).toBe(409);
    expect(await findProfessionals()).toHaveLength(0);
  });

  it('accepts a professional without specialty', async () => {
    const unit = await insertUnit();
    const { specialty: _specialty, ...body } = professionalBody([unit.id], { category: 'TECHNICIAN', registration: { council: 'COREN', number: '55', state: 'SP' } });

    const response = await create(body);

    expect(response.statusCode).toBe(201);
    expect(response.json().specialty).toBeNull();
  });

  it('responds 403 for PATIENT and PROFESSIONAL and 401 without a token', async () => {
    const unit = await insertUnit();

    expect((await create(professionalBody([unit.id]), await tokenFor(app, 'PATIENT'))).statusCode).toBe(403);
    expect((await create(professionalBody([unit.id]), await tokenFor(app, 'PROFESSIONAL'))).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/professionals', payload: professionalBody([unit.id]) })).statusCode).toBe(401);
  });
});
