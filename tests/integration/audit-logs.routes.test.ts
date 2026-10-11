import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { AuditLog, type AuditLogProps } from '../../src/modules/audit/audit.entity';
import { createAuditRepository } from '../../src/modules/audit/audit.repository';
import { clearAuditLogs, clearUsers, findAuditLogs, tokenFor } from './helpers';

const app = buildApp();
const repository = createAuditRepository(db);

const userA = randomUUID();
const userB = randomUUID();
const patientA = randomUUID();
const patientB = randomUUID();

function log(id: string, props: Pick<AuditLogProps, 'userId' | 'patientId' | 'action'> & { occurredAt: string }): AuditLogProps {
  return {
    id,
    resourceType: 'PATIENT',
    resourceId: props.patientId ?? randomUUID(),
    ip: '192.0.2.10',
    ...props,
    occurredAt: new Date(props.occurredAt),
  };
}

const logs = {
  a: log('00000000-0000-4000-8000-00000000000a', { userId: userA, patientId: patientA, action: 'READ', occurredAt: '2026-01-10T10:00:00.000Z' }),
  b: log('00000000-0000-4000-8000-00000000000b', { userId: userA, patientId: patientB, action: 'CREATE', occurredAt: '2026-02-10T10:00:00.000Z' }),
  c: log('00000000-0000-4000-8000-00000000000c', { userId: userB, patientId: patientA, action: 'UPDATE', occurredAt: '2026-03-10T10:00:00.000Z' }),
  d: log('00000000-0000-4000-8000-00000000000d', { userId: userB, patientId: patientB, action: 'READ', occurredAt: '2026-04-10T10:00:00.000Z' }),
  e: log('00000000-0000-4000-8000-00000000000e', { userId: userA, patientId: patientA, action: 'READ', occurredAt: '2026-03-20T10:00:00.000Z' }),
};

async function seed(...entries: AuditLogProps[]) {
  for (const entry of entries) {
    await repository.insert(AuditLog.restore(entry));
  }
}

async function listAuditLogs(query: Record<string, string | number> = {}, token?: string) {
  token ??= await tokenFor(app, 'ADMIN');
  return app.inject({
    method: 'GET',
    url: '/audit-logs',
    query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])),
    headers: { authorization: `Bearer ${token}` },
  });
}

function ids(body: { items: { id: string }[] }) {
  return body.items.map((item) => item.id);
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
  await clearUsers();
});

describe('GET /audit-logs', () => {
  describe('authorization', () => {
    it('responds 401 without a token', async () => {
      const response = await app.inject({ method: 'GET', url: '/audit-logs' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: 'Missing or invalid access token', error: 'Unauthorized', statusCode: 401 });
    });

    it('responds 401 with an invalid token', async () => {
      const response = await listAuditLogs({}, 'not-a-jwt');

      expect(response.statusCode).toBe(401);
    });

    it.each(['PATIENT', 'PROFESSIONAL'] as const)('responds 403 to the %s role', async (role) => {
      const response = await listAuditLogs({}, await tokenFor(app, role));

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'Forbidden', statusCode: 403 });
    });
  });

  describe('response', () => {
    it('responds 200 with an empty page when nothing matches', async () => {
      const response = await listAuditLogs({ userId: randomUUID() });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it('returns every field with occurredAt in ISO 8601', async () => {
      await seed(logs.a);

      const response = await listAuditLogs();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            id: logs.a.id,
            userId: userA,
            action: 'READ',
            resourceType: 'PATIENT',
            resourceId: patientA,
            patientId: patientA,
            ip: '192.0.2.10',
            occurredAt: '2026-01-10T10:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    });

    it('returns a null patientId when the log has none', async () => {
      await seed(log(randomUUID(), { userId: userA, patientId: null, action: 'CREATE', occurredAt: '2026-01-01T00:00:00.000Z' }));

      const response = await listAuditLogs();

      expect(response.json().items[0].patientId).toBeNull();
    });

    it('orders by occurredAt descending and by id descending on ties', async () => {
      const tieLow = log('00000000-0000-4000-8000-000000000001', { userId: userA, patientId: patientA, action: 'READ', occurredAt: '2026-03-20T10:00:00.000Z' });
      const tieHigh = log('00000000-0000-4000-8000-000000000002', { userId: userA, patientId: patientA, action: 'READ', occurredAt: '2026-03-20T10:00:00.000Z' });
      await seed(logs.a, tieLow, logs.d, tieHigh, logs.b);

      const response = await listAuditLogs();

      expect(ids(response.json())).toEqual([logs.d.id, tieHigh.id, tieLow.id, logs.b.id, logs.a.id]);
    });

    it('paginates and reports the total', async () => {
      await seed(...Object.values(logs));

      const first = await listAuditLogs({ page: 1, pageSize: 2 });
      const last = await listAuditLogs({ page: 3, pageSize: 2 });
      const beyond = await listAuditLogs({ page: 4, pageSize: 2 });

      expect(first.json()).toMatchObject({ page: 1, pageSize: 2, total: 5 });
      expect(ids(first.json())).toEqual([logs.d.id, logs.e.id]);
      expect(ids(last.json())).toEqual([logs.a.id]);
      expect(beyond.json()).toMatchObject({ items: [], total: 5 });
    });

    it('does not record a new audit log when the trail is read', async () => {
      await seed(logs.a);

      await listAuditLogs();

      expect(await findAuditLogs()).toHaveLength(1);
    });
  });

  describe('filters', () => {
    beforeEach(async () => {
      await seed(...Object.values(logs));
    });

    it.each([
      ['userId', () => ({ userId: userA }), ['e', 'b', 'a']],
      ['patientId', () => ({ patientId: patientA }), ['e', 'c', 'a']],
      ['action', () => ({ action: 'READ' }), ['d', 'e', 'a']],
      ['from (inclusive)', () => ({ from: '2026-03-10T10:00:00.000Z' }), ['d', 'e', 'c']],
      ['to (inclusive)', () => ({ to: '2026-02-10T10:00:00.000Z' }), ['b', 'a']],
      ['from with a time zone offset', () => ({ from: '2026-03-20T07:00:00-03:00' }), ['d', 'e']],
      [
        'all combined',
        () => ({ userId: userA, patientId: patientA, action: 'READ', from: '2026-02-01T00:00:00Z', to: '2026-03-31T23:59:59Z' }),
        ['e'],
      ],
    ] as const)('filters by %s', async (_, query, expected) => {
      const response = await listAuditLogs(query());

      expect(response.statusCode).toBe(200);
      expect(ids(response.json())).toEqual(expected.map((key) => logs[key].id));
      expect(response.json().total).toBe(expected.length);
    });

    it('accepts from equal to to', async () => {
      const response = await listAuditLogs({ from: logs.c.occurredAt.toISOString(), to: logs.c.occurredAt.toISOString() });

      expect(ids(response.json())).toEqual([logs.c.id]);
    });
  });

  describe('validation', () => {
    it.each([
      ['userId is not a UUID', { userId: '123' }],
      ['patientId is not a UUID', { patientId: 'abc' }],
      ['action is unknown', { action: 'DELETE' }],
      ['from is not ISO 8601', { from: '10/03/2026' }],
      ['to is not ISO 8601', { to: 'yesterday' }],
      ['page is 0', { page: 0 }],
      ['page is not an integer', { page: 1.5 }],
      ['pageSize is 0', { pageSize: 0 }],
      ['pageSize is above 100', { pageSize: 101 }],
      ['from is after to', { from: '2026-03-02T00:00:00Z', to: '2026-03-01T00:00:00Z' }],
    ])('responds 400 when %s', async (_, query) => {
      const response = await listAuditLogs(query);

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        message: 'Request validation failed',
        error: 'Bad Request',
        statusCode: 400,
        details: [expect.objectContaining({ location: 'querystring', path: expect.any(String), message: expect.any(String) })],
      });
    });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('does not expose %s', async (method) => {
    await seed(logs.a);

    const token = await tokenFor(app, 'ADMIN');
    const collection = await app.inject({ method, url: '/audit-logs', headers: { authorization: `Bearer ${token}` } });
    const item = await app.inject({ method, url: `/audit-logs/${logs.a.id}`, headers: { authorization: `Bearer ${token}` } });

    expect(collection.statusCode).toBe(404);
    expect(item.statusCode).toBe(404);
    expect(await findAuditLogs()).toHaveLength(1);
  });

  it('documents the route and its enums in the OpenAPI spec', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' });
    const spec = response.json();

    expect(spec.paths['/audit-logs'].get).toMatchObject({ tags: ['audit'], security: [{ bearerAuth: [] }] });
    expect(Object.keys(spec.paths['/audit-logs'])).toEqual(['get']);
    expect(spec.components.schemas.AuditAction.enum).toEqual(['READ', 'CREATE', 'UPDATE', 'CORRECT', 'EXPORT', 'ACCESS_DENIED']);
    expect(spec.components.schemas.AuditResourceType.enum).toEqual(['MEDICAL_RECORD_ENTRY', 'PRESCRIPTION', 'EXAM', 'ADMISSION', 'PATIENT']);
    expect(spec.components.schemas.AuditLog.properties).toHaveProperty('occurredAt');
  });
});
