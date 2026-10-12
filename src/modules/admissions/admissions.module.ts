import type { Database } from '../../db/client';
import type { AuditService } from '../audit/services/audit.service';
import type { PatientsService } from '../patients/services/patients.service';
import type { ProfessionalsService } from '../professionals/services/professionals.service';
import type { UnitsService } from '../units/services/units.service';
import { admissionsRoutes } from './admissions.routes';
import { createAdmissionRepository } from './repositories/admission.repository';
import { createBedRepository } from './repositories/bed.repository';
import { createAdmissionsService } from './services/admissions.service';

export function createAdmissionsModule(deps: {
  db: Database;
  audit: AuditService;
  units: UnitsService;
  patients: PatientsService;
  professionals: ProfessionalsService;
  clock?: () => Date;
}) {
  const service = createAdmissionsService({
    db: deps.db,
    beds: createBedRepository(deps.db),
    admissions: createAdmissionRepository(deps.db),
    audit: deps.audit,
    units: deps.units,
    patients: deps.patients,
    professionals: deps.professionals,
    clock: deps.clock ?? (() => new Date()),
  });

  deps.units.registerDeactivationCheck((unitId, tx) => service.activeAdmissionsPendency({ unitId }, tx));
  deps.professionals.registerPendencyCheck((target, tx) => service.activeAdmissionsPendency(target, tx));

  return { service, routes: admissionsRoutes(service) };
}
