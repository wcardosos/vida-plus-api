import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { Database } from './db/client';
import { env } from './env';
import { createAdmissionsModule } from './modules/admissions/admissions.module';
import { createAuditModule } from './modules/audit/audit.module';
import { createAuthModule } from './modules/auth/auth.module';
import { createLgpdModule } from './modules/lgpd/lgpd.module';
import { createMedicalRecordsModule } from './modules/medical-records/medical-records.module';
import { createPatientsModule } from './modules/patients/patients.module';
import { createProfessionalsModule } from './modules/professionals/professionals.module';
import { createSchedulingModule } from './modules/scheduling/scheduling.module';
import type { AppointmentNotifier } from './modules/scheduling/services/appointment-notifier';
import { createUnitsModule } from './modules/units/units.module';
import { createConsoleEmailSender, type EmailSender } from './shared/email-sender';

export type ContainerDeps = {
  db: Database;
  logger: FastifyBaseLogger;
  emailSender?: EmailSender;
  appointmentNotifier?: AppointmentNotifier;
  clock?: () => Date;
};

export function createContainer(deps: ContainerDeps) {
  const { db, logger } = deps;
  const emailSender = deps.emailSender ?? createConsoleEmailSender(logger);

  const audit = createAuditModule({ db, logger });
  const auth = createAuthModule({
    db,
    logger,
    emailSender,
    config: { appUrl: env.APP_URL, resetTokenTtlMs: env.RESET_TOKEN_TTL, setupTokenTtlMs: env.PASSWORD_SETUP_TOKEN_TTL },
  });
  const units = createUnitsModule({ db });
  const lgpd = createLgpdModule({ db, clock: deps.clock, config: { termsVersion: env.TERMS_VERSION } });
  const patients = createPatientsModule({
    db,
    auth: auth.service,
    audit: audit.service,
    lgpd: lgpd.service,
    config: { termsVersion: env.TERMS_VERSION },
  });
  const professionals = createProfessionalsModule({ db, auth: auth.service, units: units.service });
  const scheduling = createSchedulingModule({
    db,
    logger,
    professionals: professionals.service,
    patients: patients.service,
    units: units.service,
    lgpd: lgpd.service,
    notifier: deps.appointmentNotifier,
    clock: deps.clock,
    config: { timeZone: env.APP_TIMEZONE, termsVersion: env.TERMS_VERSION },
  });
  const admissions = createAdmissionsModule({
    db,
    audit: audit.service,
    units: units.service,
    patients: patients.service,
    professionals: professionals.service,
    clock: deps.clock,
  });
  const medicalRecords = createMedicalRecordsModule({
    db,
    audit: audit.service,
    patients: patients.service,
    professionals: professionals.service,
    scheduling: scheduling.service,
    admissions: admissions.service,
    clock: deps.clock,
    config: { timeZone: env.APP_TIMEZONE, clinicalDataKey: env.CLINICAL_DATA_KEY },
  });

  return {
    services: {
      audit: audit.service,
      auth: auth.service,
      units: units.service,
      lgpd: lgpd.service,
      patients: patients.service,
      professionals: professionals.service,
      scheduling: scheduling.service,
      admissions: admissions.service,
      medicalRecords: medicalRecords.service,
    },
    routes: [
      audit.routes,
      auth.routes,
      units.routes,
      patients.routes,
      lgpd.routes,
      professionals.routes,
      scheduling.routes,
      admissions.routes,
      medicalRecords.routes,
    ] satisfies FastifyPluginAsync[],
  };
}

export type Container = ReturnType<typeof createContainer>;
