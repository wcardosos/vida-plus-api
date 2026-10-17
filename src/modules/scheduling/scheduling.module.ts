import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/client';
import type { LgpdService } from '../lgpd/services/lgpd.service';
import type { PatientsService } from '../patients/services/patients.service';
import type { ProfessionalsService } from '../professionals/services/professionals.service';
import type { UnitsService } from '../units/services/units.service';
import { createAppointmentRepository } from './repositories/appointment.repository';
import { createScheduleAvailabilityRepository } from './repositories/schedule-availability.repository';
import { createScheduleBlockRepository } from './repositories/schedule-block.repository';
import { schedulingRoutes } from './scheduling.routes';
import { createNoopAppointmentNotifier, type AppointmentNotifier } from './services/appointment-notifier';
import { createSchedulingService, type SchedulingServiceConfig } from './services/scheduling.service';

export function createSchedulingModule(deps: {
  db: Database;
  logger: FastifyBaseLogger;
  professionals: ProfessionalsService;
  patients: PatientsService;
  units: UnitsService;
  lgpd: LgpdService;
  notifier?: AppointmentNotifier;
  clock?: () => Date;
  config: SchedulingServiceConfig;
}) {
  const service = createSchedulingService({
    db: deps.db,
    logger: deps.logger,
    availabilities: createScheduleAvailabilityRepository(deps.db),
    blocks: createScheduleBlockRepository(deps.db),
    appointments: createAppointmentRepository(deps.db),
    professionals: deps.professionals,
    patients: deps.patients,
    units: deps.units,
    lgpd: deps.lgpd,
    notifier: deps.notifier ?? createNoopAppointmentNotifier(),
    clock: deps.clock ?? (() => new Date()),
    config: deps.config,
  });

  deps.units.registerDeactivationCheck((unitId, tx) => service.futureAppointmentsPendency({ unitId }, tx));
  deps.professionals.registerPendencyCheck((target, tx) => service.futureAppointmentsPendency(target, tx));
  deps.lgpd.registerRevocationHandler((revocation, tx) => service.cancelTeleconsultationsOnConsentRevocation(revocation, tx));

  return { service, routes: schedulingRoutes(service) };
}
