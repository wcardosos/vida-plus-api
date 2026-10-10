import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { db, pool } from '../../src/db/client';
import * as schema from '../../src/db/schema';
import { createAuditRepository } from '../../src/modules/audit/audit.repository';
import { createAuditService } from '../../src/modules/audit/audit.service';
import type { RequestContext } from '../../src/shared/request-context';
import { clearAuditLogs, findAuditLogs } from './helpers';

function captureLogger() {
  const entries: Record<string, unknown>[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => entries.push(JSON.parse(line)) });
  return { logger, entries };
}

const auditService = createAuditService({ repository: createAuditRepository(db), logger: captureLogger().logger });

function requestContext(): RequestContext {
  return { userId: randomUUID(), ip: '198.51.100.23' };
}

class Rollback extends Error {}

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await clearAuditLogs();
});

describe('auditService.record', () => {
  it('persists exactly one row with every given field when the transaction commits', async () => {
    const ctx = requestContext();
    const input = { action: 'CREATE', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: randomUUID(), patientId: randomUUID() } as const;
    const before = new Date();

    await db.transaction(async (tx) => {
      await auditService.record(ctx, input, tx);
    });

    const rows = await findAuditLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...input, userId: ctx.userId, ip: ctx.ip });
    expect(rows[0].id).toEqual(expect.any(String));
    expect(rows[0].occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('leaves no row when the transaction fails after recording', async () => {
    const ctx = requestContext();
    const patientId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await auditService.record(ctx, { action: 'UPDATE', resourceType: 'EXAM', resourceId: randomUUID(), patientId }, tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(await findAuditLogs()).toEqual([]);
  });

  it('writes on the main connection when no transaction is given', async () => {
    const ctx = requestContext();
    const patientId = randomUUID();

    await auditService.record(ctx, { action: 'READ', resourceType: 'PATIENT', resourceId: patientId, patientId });

    expect(await findAuditLogs()).toHaveLength(1);
  });

  it('stores a null patientId when it is not given', async () => {
    await auditService.record(requestContext(), { action: 'CREATE', resourceType: 'ADMISSION', resourceId: randomUUID() });

    const [row] = await findAuditLogs();
    expect(row.patientId).toBeNull();
  });
});

describe('auditService.recordAccessDenied', () => {
  it('records an ACCESS_DENIED entry on the patient', async () => {
    const ctx = requestContext();
    const patientId = randomUUID();

    await auditService.recordAccessDenied(ctx, patientId);

    const rows = await findAuditLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ctx.userId,
      ip: ctx.ip,
      action: 'ACCESS_DENIED',
      resourceType: 'PATIENT',
      resourceId: patientId,
      patientId,
    });
  });

  it('does not accept a transaction parameter', () => {
    expectTypeOf(auditService.recordAccessDenied).parameters.toEqualTypeOf<[RequestContext, string]>();
  });

  it('keeps the entry when called during a transaction that is rolled back', async () => {
    const ctx = requestContext();
    const patientId = randomUUID();

    await expect(
      db.transaction(async (tx) => {
        await auditService.record(ctx, { action: 'READ', resourceType: 'PATIENT', resourceId: patientId, patientId }, tx);
        await auditService.recordAccessDenied(ctx, patientId);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    const rows = await findAuditLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'ACCESS_DENIED', patientId });
  });

  it('resolves without throwing and logs an error when the write fails', async () => {
    const unreachablePool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:1/unreachable', connectionTimeoutMillis: 1000 });
    const { logger, entries } = captureLogger();
    const service = createAuditService({
      repository: createAuditRepository(drizzle({ client: unreachablePool, schema })),
      logger,
    });
    const ctx = requestContext();
    const patientId = randomUUID();

    try {
      await expect(service.recordAccessDenied(ctx, patientId)).resolves.toBeUndefined();
    } finally {
      await unreachablePool.end();
    }

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({ level: 50, msg: 'failed to record access denied audit log', userId: ctx.userId, patientId });
    expect(Object.keys(entry).sort()).toEqual(['err', 'hostname', 'level', 'msg', 'patientId', 'pid', 'time', 'userId']);
    expect(entry.err).not.toHaveProperty('params');
    expect(entry.err).not.toHaveProperty('query');
  });
});
