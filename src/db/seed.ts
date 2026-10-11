import { pino } from 'pino';
import { createContainer, type Container } from '../container';
import { env } from '../env';
import type { CreateUnitProps } from '../modules/units/entities/unit.entity';
import { ConflictError } from '../shared/errors';
import { loggerOptions } from '../shared/logger';
import { db, pool } from './client';

const logger = pino(loggerOptions);

const demoUnits: CreateUnitProps[] = [
  {
    name: 'Hospital Vida Plus Centro',
    type: 'HOSPITAL',
    cnpj: 'VP.LUS.H01/0001-06',
    address: { street: 'Avenida Paulista', number: '1500', district: 'Bela Vista', city: 'São Paulo', state: 'SP', zipCode: '01310-200' },
  },
  {
    name: 'Clínica Vida Plus Jardins',
    type: 'CLINIC',
    cnpj: 'VP.LUS.C01/0001-66',
    address: {
      street: 'Rua Oscar Freire',
      number: '320',
      complement: 'Conjunto 41',
      district: 'Jardins',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01426-000',
    },
  },
  {
    name: 'Laboratório Vida Plus Campinas',
    type: 'LABORATORY',
    cnpj: 'VP.LUS.L01/0001-03',
    address: { street: 'Avenida Norte-Sul', number: '800', district: 'Cambuí', city: 'Campinas', state: 'SP', zipCode: '13025-320' },
  },
  {
    name: 'Vida Plus Home Care',
    type: 'HOME_CARE',
    cnpj: 'VP.LUS.D01/0001-92',
    address: { street: 'Rua da Aurora', number: 's/n', district: 'Boa Vista', city: 'Recife', state: 'PE', zipCode: '50050-000' },
  },
];

async function seedAdmin(services: Container['services']) {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to seed the first administrator');
  }

  const { user, created } = await services.auth.ensureAdmin({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });

  if (created) {
    logger.info({ userId: user.id }, 'administrator created');
  } else if (user.role !== 'ADMIN') {
    logger.warn({ userId: user.id, role: user.role }, 'seed email belongs to a non-admin user; nothing changed');
  } else {
    logger.info({ userId: user.id }, 'administrator already exists; nothing changed');
  }
}

async function seedUnits(services: Container['services']) {
  for (const input of demoUnits) {
    try {
      const unit = await services.units.create(input);
      logger.info({ unitId: unit.id, type: unit.type }, 'demo unit created');
    } catch (error) {
      if (!(error instanceof ConflictError)) {
        throw error;
      }
      logger.info({ name: input.name }, 'demo unit already exists; nothing changed');
    }
  }
}

try {
  const { services } = createContainer({ db, logger });
  await seedAdmin(services);
  await seedUnits(services);
} catch (err) {
  logger.fatal({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
