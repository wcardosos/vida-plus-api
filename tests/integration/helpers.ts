import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/client';
import { auditLogs } from '../../src/modules/audit/schema';
import { User } from '../../src/modules/auth/entities/user.entity';
import { createUserRepository } from '../../src/modules/auth/repositories/user.repository';
import { passwordResetTokens, users } from '../../src/modules/auth/schema';
import { lgpdConsents } from '../../src/modules/lgpd/schema';
import { Patient } from '../../src/modules/patients/entities/patient.entity';
import { createPatientRepository } from '../../src/modules/patients/repositories/patient.repository';
import { patients } from '../../src/modules/patients/schema';
import {
  Professional,
  type CouncilRegistrationInput,
  type ProfessionalCategory,
} from '../../src/modules/professionals/entities/professional.entity';
import { createProfessionalRepository } from '../../src/modules/professionals/repositories/professional.repository';
import { professionals, professionalUnits } from '../../src/modules/professionals/schema';
import { Unit, type UnitType } from '../../src/modules/units/entities/unit.entity';
import { createUnitRepository } from '../../src/modules/units/repositories/unit.repository';
import { units } from '../../src/modules/units/schema';
import type { EmailMessage, EmailSender } from '../../src/shared/email-sender';
import type { AddressInput } from '../../src/shared/value-objects/address';
import type { Role } from '../../src/shared/roles';
import { generateCnpj } from '../fixtures/cnpj';
import { generateCpf } from '../fixtures/cpf';

const userRepository = createUserRepository(db);
const unitRepository = createUnitRepository(db);
const patientRepository = createPatientRepository(db);
const professionalRepository = createProfessionalRepository(db);

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
  await db.delete(lgpdConsents);
  await db.delete(patients);
  await db.delete(professionalUnits);
  await db.delete(professionals);
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
  await db.delete(professionalUnits);
  await db.delete(units);
}

export async function findUnits() {
  return db.select().from(units);
}

export type InsertPatientOptions = {
  name?: string;
  cpf?: string;
  birthDate?: string;
  email?: string;
  active?: boolean;
};

export async function insertPatient(options: InsertPatientOptions = {}): Promise<{ patient: Patient; user: User }> {
  const user = await insertUser({ role: 'PATIENT', email: options.email, active: options.active });
  const patient = Patient.create({
    userId: user.id,
    name: options.name ?? 'Maria da Silva',
    cpf: options.cpf ?? generateCpf(),
    birthDate: options.birthDate ?? '1990-04-12',
    phone: '83999990000',
    address: addressInput(),
    acceptTerms: true,
    termsVersion: '2026-10',
  });
  await patientRepository.insert(patient);
  return { patient, user };
}

export async function findPatients() {
  return db.select().from(patients);
}

export async function findConsents() {
  return db.select().from(lgpdConsents);
}

export type InsertProfessionalOptions = {
  name?: string;
  email?: string;
  category?: ProfessionalCategory;
  registration?: Partial<CouncilRegistrationInput>;
  specialty?: string | null;
  unitIds: string[];
  active?: boolean;
};

let registrationCounter = 0;

export async function insertProfessional(options: InsertProfessionalOptions): Promise<{ professional: Professional; user: User }> {
  const category = options.category ?? 'PHYSICIAN';
  registrationCounter += 1;
  const user = await insertUser({ role: 'PROFESSIONAL', email: options.email, active: options.active });
  const professional = Professional.create({
    userId: user.id,
    name: options.name ?? 'Dra. Ana Lima',
    category,
    registration: {
      council: category === 'PHYSICIAN' ? 'CRM' : 'COREN',
      number: `${90000 + registrationCounter}`,
      state: 'SP',
      ...options.registration,
    },
    specialty: options.specialty,
    unitIds: options.unitIds,
  });
  await professionalRepository.insert(professional);
  return { professional, user };
}

export async function findProfessionals() {
  return db.select().from(professionals);
}

export async function findProfessionalUnits() {
  return db.select().from(professionalUnits);
}
