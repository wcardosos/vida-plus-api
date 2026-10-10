import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/client';
import { auditLogs } from '../../src/modules/audit/schema';
import type { Role } from '../../src/shared/roles';

export function signToken(app: FastifyInstance, role: Role, userId: string = randomUUID()) {
  return app.jwt.sign({ sub: userId, role });
}

export async function clearAuditLogs() {
  await db.delete(auditLogs);
}

export async function findAuditLogs() {
  return db.select().from(auditLogs);
}
