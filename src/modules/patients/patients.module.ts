import type { Database } from '../../db/client';
import type { AuditService } from '../audit/services/audit.service';
import type { AuthService } from '../auth/services/auth.service';
import type { LgpdService } from '../lgpd/services/lgpd.service';
import { patientsRoutes } from './patients.routes';
import { createPatientRepository } from './repositories/patient.repository';
import { createPatientsService, type PatientsServiceConfig } from './services/patients.service';

export function createPatientsModule(deps: {
  db: Database;
  auth: AuthService;
  audit: AuditService;
  lgpd: LgpdService;
  config: PatientsServiceConfig;
}) {
  const service = createPatientsService({
    db: deps.db,
    patients: createPatientRepository(deps.db),
    auth: deps.auth,
    audit: deps.audit,
    lgpd: deps.lgpd,
    config: deps.config,
  });
  deps.lgpd.registerPatientResolver(async (userId) => (await service.getByUserId(userId)).patient.id);

  return { service, routes: patientsRoutes(service) };
}
