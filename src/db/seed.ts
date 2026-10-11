import { pino } from 'pino';
import { createContainer } from '../container';
import { env } from '../env';
import { loggerOptions } from '../shared/logger';
import { db, pool } from './client';

const logger = pino(loggerOptions);

async function seed() {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set to seed the first administrator');
  }

  const { services } = createContainer({ db, logger });
  const { user, created } = await services.auth.ensureAdmin({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });

  if (created) {
    logger.info({ userId: user.id }, 'administrator created');
  } else if (user.role !== 'ADMIN') {
    logger.warn({ userId: user.id, role: user.role }, 'seed email belongs to a non-admin user; nothing changed');
  } else {
    logger.info({ userId: user.id }, 'administrator already exists; nothing changed');
  }
}

try {
  await seed();
} catch (err) {
  logger.fatal({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
