import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/client';
import { auditLogs } from '../../src/modules/audit/schema';
import { User } from '../../src/modules/auth/entities/user.entity';
import { createUserRepository } from '../../src/modules/auth/repositories/user.repository';
import { passwordResetTokens, users } from '../../src/modules/auth/schema';
import { Unit, type UnitType } from '../../src/modules/units/entities/unit.entity';
import { createUnitRepository } from '../../src/modules/units/repositories/unit.repository';
import { units } from '../../src/modules/units/schema';
import type { EmailMessage, EmailSender } from '../../src/shared/email-sender';
import type { AddressInput } from '../../src/shared/value-objects/address';
import type { Role } from '../../src/shared/roles';
import { generateCnpj } from '../fixtures/cnpj';

const userRepository = createUserRepository(db);
const unitRepository = createUnitRepository(db);

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

export function addressInput(overrides: Partial<AddressInput> = {}): AddressInput {
  return {
    street: 'Avenida Paulista',
    number: '1000',
    complement: null,
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310-100',
    ...overrides,
  };
}

export type InsertUnitOptions = {
  name?: string;
  type?: UnitType;
  cnpj?: string;
  address?: Partial<AddressInput>;
  active?: boolean;
};

export async function insertUnit(options: InsertUnitOptions = {}): Promise<Unit> {
  const unit = Unit.create({
    name: options.name ?? `Unit ${randomUUID()}`,
    type: options.type ?? 'CLINIC',
    cnpj: options.cnpj ?? generateCnpj(),
    address: addressInput(options.address),
  });
  if (options.active === false) {
    unit.deactivate();
  }
  await unitRepository.insert(unit);
  return unit;
}

export async function clearUnits() {
  await db.delete(units);
}

export async function findUnits() {
  return db.select().from(units);
}
