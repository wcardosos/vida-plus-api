import type { Database, Transaction } from '../../../db/client';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { RequestContext } from '../../../shared/request-context';
import type { Role } from '../../../shared/roles';
import type { AuditService } from '../../audit/services/audit.service';
import type { PatientsService } from '../../patients/services/patients.service';
import type { ProfessionalsService } from '../../professionals/services/professionals.service';
import type { UnitsService } from '../../units/services/units.service';
import type { AdmissionMovement } from '../entities/admission-movement.entity';
import { Admission } from '../entities/admission.entity';
import { Bed, type BedType, type CreateBedProps, type ManualBedStatus, type UpdateBedProps } from '../entities/bed.entity';
import type {
  ActiveAdmissionsFilter,
  AdmissionFilters,
  AdmissionRepository,
  Pagination,
  Period,
} from '../repositories/admission.repository';
import type { BedFilters, BedRepository, OccupancyMap } from '../repositories/bed.repository';

export type Viewer = RequestContext & {
  role: Role;
};

export type Reference = {
  id: string;
  name: string;
};

export type BedSummary = {
  id: string;
  identification: string;
  sector: string;
  type: BedType;
};

export type MovementDetails = {
  movement: AdmissionMovement;
  fromBed: BedSummary | null;
  toBed: BedSummary | null;
};

export type AdmissionDetails = {
  admission: Admission;
  patient: Reference;
  responsibleProfessional: Reference;
  unit: Reference;
  currentBed: BedSummary;
  movements: MovementDetails[];
};

export type CreateBedInput = Omit<CreateBedProps, 'unitId'>;

export type AdmitInput = {
  patientId: string;
  bedId: string;
  responsibleProfessionalId: string;
};

export type ActiveAdmissionsPendency = {
  type: 'ACTIVE_ADMISSIONS';
  count: number;
};

export type AdmissionsService = ReturnType<typeof createAdmissionsService>;

export function createAdmissionsService(deps: {
  db: Database;
  beds: BedRepository;
  admissions: AdmissionRepository;
  audit: AuditService;
  units: UnitsService;
  patients: PatientsService;
  professionals: ProfessionalsService;
  clock: () => Date;
}) {
  const { db, beds, admissions, audit, units, patients, professionals, clock } = deps;

  function summaryOf(bed: Bed): BedSummary {
    return { id: bed.id, identification: bed.identification, sector: bed.sector, type: bed.type };
  }

  async function withReferences(list: Admission[]): Promise<AdmissionDetails[]> {
    if (list.length === 0) {
      return [];
    }
    const bedIds = list.flatMap((admission) => [
      admission.currentBedId,
      ...admission.getMovements().flatMap((movement) => [movement.fromBedId, movement.toBedId]),
    ]);
    const [patientList, professionalList, unitList, bedList] = await Promise.all([
      patients.listByIds(list.map((admission) => admission.patientId)),
      professionals.listByIds(list.map((admission) => admission.responsibleProfessionalId)),
      units.listByIds(list.map((admission) => admission.unitId)),
      beds.findByIds([...new Set(bedIds.filter((id): id is string => id !== null))]),
    ]);
    const names = new Map<string, string>([...patientList, ...professionalList, ...unitList].map((item) => [item.id, item.name]));
    const reference = (id: string): Reference => ({ id, name: names.get(id) ?? '' });
    const bedById = new Map(bedList.map((bed) => [bed.id, summaryOf(bed)]));
    const bedSummary = (id: string | null): BedSummary | null => (id === null ? null : (bedById.get(id) ?? null));

    return list.map((admission) => ({
      admission,
      patient: reference(admission.patientId),
      responsibleProfessional: reference(admission.responsibleProfessionalId),
      unit: reference(admission.unitId),
      currentBed: bedSummary(admission.currentBedId)!,
      movements: admission.getMovements().map((movement) => ({
        movement,
        fromBed: bedSummary(movement.fromBedId),
        toBed: bedSummary(movement.toBedId),
      })),
    }));
  }

  async function withReference(admission: Admission): Promise<AdmissionDetails> {
    const [details] = await withReferences([admission]);
    return details;
  }

  async function lockBed(id: string, tx: Transaction): Promise<Bed> {
    const [bed] = await beds.lockByIds([id], tx);
    if (!bed) {
      throw new NotFoundError('Bed not found');
    }
    return bed;
  }

  async function loadForUpdate(id: string, tx: Transaction): Promise<Admission> {
    const admission = await admissions.findByIdForUpdate(id, tx);
    if (!admission) {
      throw new NotFoundError('Admission not found');
    }
    return admission;
  }

  async function ensureIdentificationIsFree(bed: Bed, tx?: Transaction): Promise<void> {
    if (await beds.existsByIdentification(bed.unitId, bed.identification, bed.id, tx)) {
      throw new ConflictError('Bed identification is already in use in this unit');
    }
  }

  async function createBed(unitId: string, input: CreateBedInput): Promise<Bed> {
    await units.assertHospital(unitId);
    const bed = Bed.create({ ...input, unitId }, clock());
    await ensureIdentificationIsFree(bed);
    await beds.insert(bed);
    return bed;
  }

  async function updateBed(id: string, changes: UpdateBedProps): Promise<Bed> {
    return db.transaction(async (tx) => {
      const bed = await lockBed(id, tx);
      const previousIdentification = bed.identification;
      bed.update(changes);
      if (bed.identification !== previousIdentification) {
        await ensureIdentificationIsFree(bed, tx);
      }
      await beds.update(bed, tx);
      return bed;
    });
  }

  async function changeBedStatus(id: string, status: ManualBedStatus): Promise<Bed> {
    return db.transaction(async (tx) => {
      const bed = await lockBed(id, tx);
      bed.changeStatus(status);
      await beds.update(bed, tx);
      return bed;
    });
  }

  async function listBeds(unitId: string, filters: BedFilters): Promise<OccupancyMap> {
    if (!(await units.existsById(unitId))) {
      throw new NotFoundError('Unit not found');
    }
    return beds.findOccupancyMap(unitId, filters);
  }

  async function admit(ctx: RequestContext, input: AdmitInput): Promise<AdmissionDetails> {
    const now = clock();
    const [{ patient, account: patientAccount }, responsible] = await Promise.all([
      patients.getById(input.patientId),
      professionals.getById(input.responsibleProfessionalId),
    ]);
    if (!patientAccount.active) {
      throw new DomainError('Patient is inactive');
    }
    if (!responsible.account.active) {
      throw new DomainError('Responsible professional is inactive');
    }

    const admission = await db.transaction(async (tx) => {
      const bed = await lockBed(input.bedId, tx);
      await units.assertHospital(bed.unitId, tx);
      if (!responsible.professional.isLinkedTo(bed.unitId)) {
        throw new DomainError('Responsible professional is not linked to the unit of the bed');
      }
      if (await admissions.existsActiveByPatient(patient.id, tx)) {
        throw new ConflictError('Patient already has an active admission');
      }
      if (bed.isOccupied()) {
        throw new ConflictError('Bed is no longer available');
      }

      const created = Admission.admit({ patientId: patient.id, responsibleProfessionalId: responsible.professional.id, bed }, now);
      await admissions.insert(created, tx);
      await beds.update(bed, tx);
      await audit.record(ctx, { action: 'CREATE', resourceType: 'ADMISSION', resourceId: created.id, patientId: created.patientId }, tx);
      return created;
    });

    return withReference(admission);
  }

  async function transfer(ctx: RequestContext, id: string, toBedId: string): Promise<AdmissionDetails> {
    const now = clock();
    const admission = await db.transaction(async (tx) => {
      const current = await loadForUpdate(id, tx);
      const locked = await beds.lockByIds([current.currentBedId, toBedId], tx);
      const from = locked.find((bed) => bed.id === current.currentBedId)!;
      const to = locked.find((bed) => bed.id === toBedId);
      if (!to) {
        throw new NotFoundError('Bed not found');
      }
      current.ensureCanMoveTo(to);
      if (to.isOccupied()) {
        throw new ConflictError('Destination bed is no longer available');
      }

      current.transfer(from, to, now);
      await admissions.update(current, tx);
      await beds.update(from, tx);
      await beds.update(to, tx);
      await audit.record(ctx, { action: 'UPDATE', resourceType: 'ADMISSION', resourceId: current.id, patientId: current.patientId }, tx);
      return current;
    });

    return withReference(admission);
  }

  async function discharge(ctx: RequestContext, id: string): Promise<AdmissionDetails> {
    const now = clock();
    const admission = await db.transaction(async (tx) => {
      const current = await loadForUpdate(id, tx);
      const bed = await lockBed(current.currentBedId, tx);
      current.discharge(bed, now);
      await admissions.update(current, tx);
      await beds.update(bed, tx);
      await audit.record(ctx, { action: 'UPDATE', resourceType: 'ADMISSION', resourceId: current.id, patientId: current.patientId }, tx);
      return current;
    });

    return withReference(admission);
  }

  async function list(filters: AdmissionFilters, pagination: Pagination) {
    const { items, total } = await admissions.findMany(filters, pagination);
    return { items: await withReferences(items), total };
  }

  async function denyAccess(ctx: RequestContext, admission: Admission, message: string): Promise<never> {
    await audit.recordAccessDenied(ctx, admission.patientId, { resourceType: 'ADMISSION', resourceId: admission.id });
    throw new ForbiddenError(message);
  }

  async function ensureCanView(viewer: Viewer, admission: Admission): Promise<void> {
    if (viewer.role === 'ADMIN') {
      return;
    }
    if (viewer.role === 'PROFESSIONAL') {
      const { professional } = await professionals.getByUserId(viewer.userId);
      if (!admission.isResponsible(professional.id)) {
        await denyAccess(viewer, admission, 'Only the responsible professional can access this admission');
      }
      return;
    }
    const { patient } = await patients.getByUserId(viewer.userId);
    if (admission.patientId !== patient.id) {
      await denyAccess(viewer, admission, 'Patients can only access their own admissions');
    }
  }

  async function getById(viewer: Viewer, id: string): Promise<AdmissionDetails> {
    const admission = await admissions.findById(id);
    if (!admission) {
      throw new NotFoundError('Admission not found');
    }
    await ensureCanView(viewer, admission);
    await audit.record(viewer, { action: 'READ', resourceType: 'ADMISSION', resourceId: admission.id, patientId: admission.patientId });
    return withReference(admission);
  }

  async function listOwn(userId: string): Promise<AdmissionDetails[]> {
    const { professional } = await professionals.getByUserId(userId);
    return withReferences(await admissions.findActiveByResponsible(professional.id));
  }

  async function findForRecord(id: string, tx?: Transaction): Promise<Admission> {
    const admission = tx ? await admissions.findByIdForShare(id, tx) : await admissions.findById(id);
    if (!admission) {
      throw new NotFoundError('Admission not found');
    }
    return admission;
  }

  async function hasLinkWithPatient(professionalId: string, patientId: string): Promise<boolean> {
    return admissions.existsByResponsibleAndPatient(professionalId, patientId);
  }

  async function listByPatient(patientId: string, period: Period = {}): Promise<AdmissionDetails[]> {
    return withReferences(await admissions.findByPatient(patientId, period));
  }

  async function activeAdmissionsPendency(filter: ActiveAdmissionsFilter, tx?: Transaction): Promise<ActiveAdmissionsPendency | null> {
    const count = await admissions.countActive(filter, tx);
    return count > 0 ? { type: 'ACTIVE_ADMISSIONS', count } : null;
  }

  return {
    createBed,
    updateBed,
    changeBedStatus,
    listBeds,
    admit,
    transfer,
    discharge,
    list,
    getById,
    listOwn,
    findForRecord,
    hasLinkWithPatient,
    listByPatient,
    activeAdmissionsPendency,
  };
}
