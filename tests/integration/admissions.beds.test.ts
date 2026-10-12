import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { pool } from '../../src/db/client';
import type { Role } from '../../src/shared/roles';
import { bedStatus, insertBed } from './admissions-helpers';
import { clearAuditLogs, clearUnits, clearUsers, findAuditLogs, insertUnit, tokenFor } from './helpers';
import { clock, requester } from './scheduling-helpers';

const app = buildApp({ clock });
const request = requester(app);

const bedBody = { identification: 'UTI-03', sector: 'UTI adulto', type: 'ICU' };

async function adminToken() {
  return tokenFor(app, 'ADMIN');
}

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await clearAuditLogs();
  await clearUnits();
  await clearUsers();
});

describe('POST /units/:unitId/beds', () => {
  it('registers an AVAILABLE bed in a hospital without auditing it', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });

    const response = await request('POST', `/units/${unit.id}/beds`, await adminToken(), bedBody);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ unitId: unit.id, identification: 'UTI-03', sector: 'UTI adulto', type: 'ICU', status: 'AVAILABLE' });
    expect(await bedStatus(response.json().id)).toBe('AVAILABLE');
    expect(await findAuditLogs()).toHaveLength(0);
  });

  it.each(['CLINIC', 'LABORATORY', 'HOME_CARE'] as const)('rejects a %s unit with 422', async (type) => {
    const unit = await insertUnit({ type });

    const response = await request('POST', `/units/${unit.id}/beds`, await adminToken(), bedBody);

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Unit is not a hospital; only hospitals have beds');
  });

  it('rejects an inactive hospital with 422', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL', active: false });

    const response = await request('POST', `/units/${unit.id}/beds`, await adminToken(), bedBody);

    expect(response.statusCode).toBe(422);
  });

  it('rejects a repeated identification in the same unit with 409', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    await insertBed(unit, { identification: 'UTI-03' });

    const response = await request('POST', `/units/${unit.id}/beds`, await adminToken(), bedBody);

    expect(response.statusCode).toBe(409);
  });

  it('accepts the same identification in another unit', async () => {
    const other = await insertUnit({ type: 'HOSPITAL' });
    await insertBed(other, { identification: 'UTI-03' });
    const unit = await insertUnit({ type: 'HOSPITAL' });

    const response = await request('POST', `/units/${unit.id}/beds`, await adminToken(), bedBody);

    expect(response.statusCode).toBe(201);
  });

  it('returns 404 for an unknown unit', async () => {
    const response = await request('POST', `/units/${randomUUID()}/beds`, await adminToken(), bedBody);

    expect(response.statusCode).toBe(404);
  });

  it('rejects an unknown type with 400', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });

    const response = await request('POST', `/units/${unit.id}/beds`, await adminToken(), { ...bedBody, type: 'SUITE' });

    expect(response.statusCode).toBe(400);
  });
});

describe('PATCH /beds/:bedId', () => {
  it('changes identification, sector and type of a free bed', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit, { status: 'CLEANING' });

    const response = await request('PATCH', `/beds/${bed.id}`, await adminToken(), { identification: 'ENF-10', sector: 'Enfermaria', type: 'WARD' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: bed.id, identification: 'ENF-10', sector: 'Enfermaria', type: 'WARD', status: 'CLEANING' });
  });

  it('rejects editing an OCCUPIED bed with 422', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit, { status: 'OCCUPIED', type: 'WARD' });

    const response = await request('PATCH', `/beds/${bed.id}`, await adminToken(), { type: 'ICU' });

    expect(response.statusCode).toBe(422);
  });

  it('rejects an identification already used in the unit with 409', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    await insertBed(unit, { identification: 'ENF-10' });
    const bed = await insertBed(unit, { identification: 'ENF-11' });

    const response = await request('PATCH', `/beds/${bed.id}`, await adminToken(), { identification: 'ENF-10' });

    expect(response.statusCode).toBe(409);
  });

  it('rejects an empty body with 400', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit);

    const response = await request('PATCH', `/beds/${bed.id}`, await adminToken(), {});

    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for an unknown bed', async () => {
    const response = await request('PATCH', `/beds/${randomUUID()}`, await adminToken(), { sector: 'Enfermaria' });

    expect(response.statusCode).toBe(404);
  });
});

describe('GET /units/:unitId/beds', () => {
  async function occupancy() {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    await insertBed(unit, { identification: 'UTI-02', type: 'ICU', status: 'OCCUPIED' });
    await insertBed(unit, { identification: 'UTI-01', type: 'ICU', status: 'AVAILABLE' });
    await insertBed(unit, { identification: 'ENF-01', type: 'WARD', status: 'AVAILABLE' });
    await insertBed(unit, { identification: 'ENF-02', type: 'WARD', status: 'CLEANING' });
    await insertBed(unit, { identification: 'ENF-03', type: 'WARD', status: 'MAINTENANCE' });
    await insertBed(await insertUnit({ type: 'HOSPITAL' }), { identification: 'OUTRO-01' });
    return unit;
  }

  it('returns the beds of the unit by identification with the count per status', async () => {
    const unit = await occupancy();

    const response = await request('GET', `/units/${unit.id}/beds`, await adminToken());

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.beds.map((bed: { identification: string }) => bed.identification)).toEqual(['ENF-01', 'ENF-02', 'ENF-03', 'UTI-01', 'UTI-02']);
    expect(body.summary).toEqual({ AVAILABLE: 2, OCCUPIED: 1, CLEANING: 1, MAINTENANCE: 1 });
  });

  it('filters the beds by status and type; the summary keeps every status of the type', async () => {
    const unit = await occupancy();

    const response = await request('GET', `/units/${unit.id}/beds?status=AVAILABLE&type=WARD`, await adminToken());

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.beds.map((bed: { identification: string }) => bed.identification)).toEqual(['ENF-01']);
    expect(body.summary).toEqual({ AVAILABLE: 1, OCCUPIED: 0, CLEANING: 1, MAINTENANCE: 1 });
  });

  it('returns 404 for an unknown unit', async () => {
    const response = await request('GET', `/units/${randomUUID()}/beds`, await adminToken());

    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /beds/:bedId/status', () => {
  it.each([
    ['CLEANING', 'AVAILABLE'],
    ['AVAILABLE', 'MAINTENANCE'],
    ['MAINTENANCE', 'AVAILABLE'],
  ] as const)('moves a %s bed to %s', async (from, to) => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit, { status: from });

    const response = await request('PATCH', `/beds/${bed.id}/status`, await adminToken(), { status: to });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(to);
    expect(await bedStatus(bed.id)).toBe(to);
  });

  it.each(['MAINTENANCE', 'AVAILABLE'])('rejects moving an OCCUPIED bed to %s with 422', async (status) => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit, { status: 'OCCUPIED' });

    const response = await request('PATCH', `/beds/${bed.id}/status`, await adminToken(), { status });

    expect(response.statusCode).toBe(422);
    expect(await bedStatus(bed.id)).toBe('OCCUPIED');
  });

  it.each(['OCCUPIED', 'CLEANING'])('rejects the status %s with 400', async (status) => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit);

    const response = await request('PATCH', `/beds/${bed.id}/status`, await adminToken(), { status });

    expect(response.statusCode).toBe(400);
    expect(await bedStatus(bed.id)).toBe('AVAILABLE');
  });

  it('returns 404 for an unknown bed', async () => {
    const response = await request('PATCH', `/beds/${randomUUID()}/status`, await adminToken(), { status: 'AVAILABLE' });

    expect(response.statusCode).toBe(404);
  });
});

describe('bed routes access', () => {
  it.each(['PATIENT', 'PROFESSIONAL'] as Role[])('reject %s with 403', async (role) => {
    const unit = await insertUnit({ type: 'HOSPITAL' });
    const bed = await insertBed(unit);
    const token = await tokenFor(app, role);

    const responses = await Promise.all([
      request('POST', `/units/${unit.id}/beds`, token, bedBody),
      request('GET', `/units/${unit.id}/beds`, token),
      request('PATCH', `/beds/${bed.id}`, token, { sector: 'Enfermaria' }),
      request('PATCH', `/beds/${bed.id}/status`, token, { status: 'MAINTENANCE' }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
  });

  it('rejects a missing token with 401', async () => {
    const unit = await insertUnit({ type: 'HOSPITAL' });

    const response = await request('GET', `/units/${unit.id}/beds`);

    expect(response.statusCode).toBe(401);
  });
});
