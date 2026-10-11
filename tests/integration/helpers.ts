import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/client';
import { auditLogs } from '../../src/modules/audit/schema';
import { User } from '../../src/modules/auth/user.entity';
import { createUserRepository } from '../../src/modules/auth/user.repository';
import { passwordResetTokens, users } from '../../src/modules/auth/schema';
import type { EmailMessage, EmailSender } from '../../src/shared/email-sender';
import type { Role } from '../../src/shared/roles';

const userRepository = createUserRepository(db);

export type InsertUserOptions = {
  email?: string;
  role?: Role;
  passwordHash?: string;
  active?: boolean;
};

export async function insertUser(options: InsertUserOptions = {}): Promise<User> {
  const user = User.create({
    email: options.email ?? `${randomUUID()}@test.vidaplus.local`,
    passwordHash: options.passwordHash ?? 'not-a-real-hash',
    role: options.role ?? 'PATIENT',
  });
  if (options.active === false) {
    user.deactivate();
  }
  await userRepository.insert(user);
  return user;
}

export function signToken(app: FastifyInstance, user: Pick<User, 'id' | 'role'>, issuedAt?: Date) {
  const iat = issuedAt && Math.floor(issuedAt.getTime() / 1000);
  return app.jwt.sign({ sub: user.id, role: user.role, ...(iat !== undefined && { iat }) });
}

export async function tokenFor(app: FastifyInstance, role: Role) {
  return signToken(app, await insertUser({ role }));
}

export async function clearAuditLogs() {
  await db.delete(auditLogs);
}

export async function findAuditLogs() {
  return db.select().from(auditLogs);
}

export async function clearUsers() {
  await db.delete(passwordResetTokens);
  await db.delete(users);
}

export async function findUsers() {
  return db.select().from(users);
}

export async function findPasswordResetTokens() {
  return db.select().from(passwordResetTokens);
}

export function captureEmails() {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(message) {
      sent.push(message);
    },
  };
  return { sender, sent };
}

let ipCounter = 0;

export function nextIp() {
  ipCounter += 1;
  return `198.18.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
}
