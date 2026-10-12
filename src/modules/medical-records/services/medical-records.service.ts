import type { Database, Transaction } from '../../../db/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { RequestContext } from '../../../shared/request-context';
import type { Role } from '../../../shared/roles';
import { addDays, startOfZonedDay } from '../../../shared/time-zone';
import type { AdmissionDetails, AdmissionsService } from '../../admissions/services/admissions.service';
import type { AccessDeniedResource, AuditService } from '../../audit/services/audit.service';
import type { Patient } from '../../patients/entities/patient.entity';
import type { PatientsService } from '../../patients/services/patients.service';
import type { Professional } from '../../professionals/entities/professional.entity';
import type { ProfessionalsService } from '../../professionals/services/professionals.service';
import type { AppointmentDetails, SchedulingService } from '../../scheduling/services/scheduling.service';
import { MedicalRecordEntry, type ClinicalContent } from '../entities/medical-record-entry.entity';
import type { PrescriptionItemInput } from '../entities/prescription-item.entity';
import { Prescription } from '../entities/prescription.entity';
import type { MedicalRecordEntryRepository, Period } from '../repositories/medical-record-entry.repository';
import type { PrescriptionRepository } from '../repositories/prescription.repository';

export type MedicalRecordsServiceConfig = {
  timeZone: string;
};

export type Reader = RequestContext & {
  role: Role;
};

export type Reference = {
  id: string;
  name: string;
};

export type PrescriptionInput = {
  validUntil: string;
  items: PrescriptionItemInput[];
};

export type CreateEntryInput = ClinicalContent & {
  prescriptions?: PrescriptionInput[];
};

export type CorrectEntryInput = ClinicalContent & {
  correctionReason: string;
};

export const historySections = ['appointment', 'entry', 'prescription', 'admission'] as const;

export type HistorySection = (typeof historySections)[number];

export type HistoryQuery = {
  from?: string;
  to?: string;
  type?: HistorySection;
};

export type EntryDetails = {
  entry: MedicalRecordEntry;
  professional: Reference;
};

export type PrescriptionDetails = {
  prescription: Prescription;
  prescriber: Reference;
};

export type CreatedEntry = EntryDetails & {
  prescriptions: PrescriptionDetails[];
};

export type MedicalHistory = {
  patient: Reference;
  appointments: AppointmentDetails[];
  entries: (EntryDetails & { versionCount: number })[];
  prescriptions: PrescriptionDetails[];
  admissions: AdmissionDetails[];
};

export type MedicalRecordsService = ReturnType<typeof createMedicalRecordsService>;

export function createMedicalRecordsService(deps: {
  db: Database;
  entries: MedicalRecordEntryRepository;
  prescriptions: PrescriptionRepository;
  audit: AuditService;
  patients: PatientsService;
  professionals: ProfessionalsService;
  scheduling: SchedulingService;
  admissions: AdmissionsService;
  clock: () => Date;
  config: MedicalRecordsServiceConfig;
}) {
  const { db, entries, prescriptions, audit, patients, professionals, scheduling, admissions, clock, config } = deps;
  const { timeZone } = config;

  async function currentProfessional(userId: string): Promise<Professional> {
    return (await professionals.getByUserId(userId)).professional;
  }

  async function denyAccess(ctx: RequestContext, patientId: string, message: string, resource?: AccessDeniedResource): Promise<never> {
    await audit.recordAccessDenied(ctx, patientId, resource);
    throw new ForbiddenError(message);
  }

  async function attends(professionalId: string, patientId: string): Promise<boolean> {
    return (await scheduling.hasLinkWithPatient(professionalId, patientId)) || (await admissions.hasLinkWithPatient(professionalId, patientId));
  }

  async function ensureCanRead(reader: Reader, patientId: string, resource: AccessDeniedResource): Promise<void> {
    if (reader.role === 'PATIENT') {
      const { patient } = await patients.getByUserId(reader.userId);
      if (patient.id !== patientId) {
        await denyAccess(reader, patientId, 'Patients can only access their own medical records', resource);
      }
      return;
    }
    if (reader.role === 'PROFESSIONAL') {
      const professional = await currentProfessional(reader.userId);
      if (!(await attends(professional.id, patientId))) {
        await denyAccess(reader, patientId, 'Professional does not attend this patient', resource);
      }
      return;
    }
    throw new ForbiddenError('Role not allowed to access medical records');
  }

  async function professionalNames(ids: string[]): Promise<(id: string) => Reference> {
    const list = ids.length > 0 ? await professionals.listByIds(ids) : [];
    const names = new Map(list.map((professional) => [professional.id, professional.name]));
    return (id) => ({ id, name: names.get(id) ?? '' });
  }

  async function withAuthors(list: MedicalRecordEntry[]): Promise<EntryDetails[]> {
    const reference = await professionalNames(list.map((entry) => entry.professionalId));
    return list.map((entry) => ({ entry, professional: reference(entry.professionalId) }));
  }

  async function withPrescribers(list: Prescription[]): Promise<PrescriptionDetails[]> {
    const reference = await professionalNames(list.map((prescription) => prescription.prescriberId));
    return list.map((prescription) => ({ prescription, prescriber: reference(prescription.prescriberId) }));
  }

  function ensureCanIssuePrescriptions(author: Professional, input: CreateEntryInput): void {
    if ((input.prescriptions ?? []).length > 0 && !author.canPrescribe()) {
      throw new ForbiddenError('Only physicians can issue prescriptions');
    }
  }

  async function saveEntry(
    ctx: RequestContext,
    author: Professional,
    entry: MedicalRecordEntry,
    input: CreateEntryInput,
    now: Date,
    prepareOrigin: (tx: Transaction) => Promise<void>,
  ): Promise<CreatedEntry> {
    const issued = (input.prescriptions ?? []).map((prescription) =>
      Prescription.issue({ ...prescription, medicalRecordEntryId: entry.id, patientId: entry.patientId, prescriber: author }, now, timeZone),
    );

    await db.transaction(async (tx) => {
      await prepareOrigin(tx);
      await entries.insert(entry, tx);
      await audit.record(ctx, { action: 'CREATE', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: entry.id, patientId: entry.patientId }, tx);
      for (const prescription of issued) {
        await prescriptions.insert(prescription, tx);
        await audit.record(ctx, { action: 'CREATE', resourceType: 'PRESCRIPTION', resourceId: prescription.id, patientId: entry.patientId }, tx);
      }
    });

    const reference: Reference = { id: author.id, name: author.name };
    return {
      entry,
      professional: reference,
      prescriptions: issued.map((prescription) => ({ prescription, prescriber: reference })),
    };
  }

  async function createEntry(ctx: RequestContext, appointmentId: string, input: CreateEntryInput): Promise<CreatedEntry> {
    const now = clock();
    const author = await currentProfessional(ctx.userId);
    const appointment = await scheduling.findAppointmentForRecord(appointmentId);
    if (appointment.professionalId !== author.id) {
      await denyAccess(ctx, appointment.patientId, 'Only the professional of the appointment can record it');
    }
    ensureCanIssuePrescriptions(author, input);

    const entry = MedicalRecordEntry.create({ ...input, patientId: appointment.patientId, professionalId: author.id, appointmentId }, now);
    return saveEntry(ctx, author, entry, input, now, async (tx) => {
      const current = await scheduling.findAppointmentForRecord(appointmentId, tx);
      current.ensureAcceptsMedicalRecord(now);
      if (current.completesOnMedicalRecord()) {
        await scheduling.completeAppointment(current.id, tx);
      }
    });
  }

  async function createAdmissionEntry(ctx: RequestContext, admissionId: string, input: CreateEntryInput): Promise<CreatedEntry> {
    const now = clock();
    const author = await currentProfessional(ctx.userId);
    const admission = await admissions.findForRecord(admissionId);
    if (!admission.isResponsible(author.id)) {
      await denyAccess(ctx, admission.patientId, 'Only the responsible professional of the admission can record it', {
        resourceType: 'ADMISSION',
        resourceId: admission.id,
      });
    }
    ensureCanIssuePrescriptions(author, input);

    const entry = MedicalRecordEntry.create({ ...input, patientId: admission.patientId, professionalId: author.id, admissionId }, now);
    return saveEntry(ctx, author, entry, input, now, async (tx) => {
      (await admissions.findForRecord(admissionId, tx)).ensureAcceptsMedicalRecord();
    });
  }

  async function correctEntry(ctx: RequestContext, entryId: string, input: CorrectEntryInput): Promise<EntryDetails> {
    const now = clock();
    const author = await currentProfessional(ctx.userId);
    const original = await entries.findById(entryId);
    if (!original) {
      throw new NotFoundError('Medical record entry not found');
    }
    if (!original.isAuthoredBy(author.id)) {
      await denyAccess(ctx, original.patientId, 'Only the author can correct a medical record entry', {
        resourceType: 'MEDICAL_RECORD_ENTRY',
        resourceId: original.id,
      });
    }
    const correction = original.correct(input, now);

    await db.transaction(async (tx) => {
      await entries.lock(original.id, tx);
      if (await entries.hasCorrection(original.id, tx)) {
        const [current] = await entries.findChain(original.id, tx);
        throw new ConflictError('Medical record entry has already been corrected; only the current version can be corrected', {
          currentEntryId: current.id,
        });
      }
      await entries.insert(correction, tx);
      await audit.record(
        ctx,
        { action: 'CORRECT', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: correction.id, patientId: correction.patientId },
        tx,
      );
    });

    return { entry: correction, professional: { id: author.id, name: author.name } };
  }

  async function listVersions(reader: Reader, entryId: string): Promise<EntryDetails[]> {
    const entry = await entries.findById(entryId);
    if (!entry) {
      throw new NotFoundError('Medical record entry not found');
    }
    await ensureCanRead(reader, entry.patientId, { resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: entry.id });
    const chain = await entries.findChain(entry.id);
    await audit.record(reader, { action: 'READ', resourceType: 'MEDICAL_RECORD_ENTRY', resourceId: entry.id, patientId: entry.patientId });
    return withAuthors(chain);
  }

  async function getPrescription(reader: Reader, prescriptionId: string): Promise<PrescriptionDetails> {
    const prescription = await prescriptions.findById(prescriptionId);
    if (!prescription) {
      throw new NotFoundError('Prescription not found');
    }
    await ensureCanRead(reader, prescription.patientId, { resourceType: 'PRESCRIPTION', resourceId: prescription.id });
    await audit.record(reader, { action: 'READ', resourceType: 'PRESCRIPTION', resourceId: prescription.id, patientId: prescription.patientId });
    const [details] = await withPrescribers([prescription]);
    return details;
  }

  function periodOf(query: HistoryQuery): Period {
    return {
      from: query.from ? startOfZonedDay(query.from, timeZone) : undefined,
      to: query.to ? startOfZonedDay(addDays(query.to, 1), timeZone) : undefined,
    };
  }

  async function history(ctx: RequestContext, patient: Patient, query: HistoryQuery): Promise<MedicalHistory> {
    const period = periodOf(query);
    const wants = (section: HistorySection) => query.type === undefined || query.type === section;
    const [appointmentList, currentEntries, prescriptionList, admissionList] = await Promise.all([
      wants('appointment') ? scheduling.listByPatient(patient.id, period) : [],
      wants('entry') ? entries.findCurrentByPatient(patient.id, period) : [],
      wants('prescription') ? prescriptions.findByPatient(patient.id, period) : [],
      wants('admission') ? admissions.listByPatient(patient.id, period) : [],
    ]);
    const reference = await professionalNames([
      ...currentEntries.map(({ entry }) => entry.professionalId),
      ...prescriptionList.map((prescription) => prescription.prescriberId),
    ]);
    await audit.record(ctx, { action: 'READ', resourceType: 'PATIENT_HISTORY', resourceId: patient.id, patientId: patient.id });

    return {
      patient: { id: patient.id, name: patient.name },
      appointments: appointmentList,
      entries: currentEntries.map(({ entry, versionCount }) => ({ entry, versionCount, professional: reference(entry.professionalId) })),
      prescriptions: prescriptionList.map((prescription) => ({ prescription, prescriber: reference(prescription.prescriberId) })),
      admissions: admissionList,
    };
  }

  async function ownHistory(ctx: RequestContext, query: HistoryQuery): Promise<MedicalHistory> {
    const { patient } = await patients.getByUserId(ctx.userId);
    return history(ctx, patient, query);
  }

  async function patientHistory(ctx: RequestContext, patientId: string, query: HistoryQuery): Promise<MedicalHistory> {
    const { patient } = await patients.getById(patientId);
    const professional = await currentProfessional(ctx.userId);
    if (!(await attends(professional.id, patient.id))) {
      await denyAccess(ctx, patient.id, 'Professional does not attend this patient', { resourceType: 'PATIENT_HISTORY', resourceId: patient.id });
    }
    return history(ctx, patient, query);
  }

  return { createEntry, createAdmissionEntry, correctEntry, listVersions, getPrescription, ownHistory, patientHistory };
}
