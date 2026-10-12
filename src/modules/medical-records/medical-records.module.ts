import type { Database } from '../../db/client';
import { createFieldCipher } from '../../shared/crypto';
import type { AdmissionsService } from '../admissions/services/admissions.service';
import type { AuditService } from '../audit/services/audit.service';
import type { PatientsService } from '../patients/services/patients.service';
import type { ProfessionalsService } from '../professionals/services/professionals.service';
import type { SchedulingService } from '../scheduling/services/scheduling.service';
import { medicalRecordsRoutes } from './medical-records.routes';
import { createMedicalRecordEntryRepository } from './repositories/medical-record-entry.repository';
import { createPrescriptionRepository } from './repositories/prescription.repository';
import { createMedicalRecordsService, type MedicalRecordsServiceConfig } from './services/medical-records.service';

export function createMedicalRecordsModule(deps: {
  db: Database;
  audit: AuditService;
  patients: PatientsService;
  professionals: ProfessionalsService;
  scheduling: SchedulingService;
  admissions: AdmissionsService;
  clock?: () => Date;
  config: MedicalRecordsServiceConfig & { clinicalDataKey: Buffer };
}) {
  const cipher = createFieldCipher(deps.config.clinicalDataKey);
  const service = createMedicalRecordsService({
    db: deps.db,
    entries: createMedicalRecordEntryRepository(deps.db, cipher),
    prescriptions: createPrescriptionRepository(deps.db, cipher),
    audit: deps.audit,
    patients: deps.patients,
    professionals: deps.professionals,
    scheduling: deps.scheduling,
    admissions: deps.admissions,
    clock: deps.clock ?? (() => new Date()),
    config: { timeZone: deps.config.timeZone },
  });
  return { service, routes: medicalRecordsRoutes(service) };
}
