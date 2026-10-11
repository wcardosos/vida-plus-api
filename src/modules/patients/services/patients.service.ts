import type { Database, Transaction } from '../../../db/client';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import type { RequestContext } from '../../../shared/request-context';
import type { AddressInput } from '../../../shared/value-objects/address';
import type { AuditService } from '../../audit/services/audit.service';
import type { AuthService } from '../../auth/services/auth.service';
import type { LgpdService } from '../../lgpd/services/lgpd.service';
import { Cpf, Patient, type ContactInfoChanges, type IdentityCorrection } from '../entities/patient.entity';
import type { Pagination, PatientFilters, PatientRepository, PatientWithAccount } from '../repositories/patient.repository';

export type PatientsServiceConfig = {
  termsVersion: string;
};

export type CreatePatientInput = {
  name: string;
  cpf: string;
  birthDate: string;
  phone: string;
  address: AddressInput;
  email: string;
  acceptTerms: boolean;
};

export type RegisterPatientInput = CreatePatientInput & {
  password: string;
  teleconsultationConsent: boolean;
};

export type UpdatePatientInput = ContactInfoChanges & {
  email?: string;
};

export type PatientsService = ReturnType<typeof createPatientsService>;

export function createPatientsService(deps: {
  db: Database;
  patients: PatientRepository;
  auth: AuthService;
  audit: AuditService;
  lgpd: LgpdService;
  config: PatientsServiceConfig;
}) {
  const { db, patients, auth, audit, lgpd, config } = deps;

  async function withAccount(patient: Patient, tx?: Transaction): Promise<PatientWithAccount> {
    const user = await auth.getUser(patient.userId, tx);
    return { patient, account: { email: user.email, active: user.active } };
  }

  async function createWithAccount(
    input: CreatePatientInput & { password?: string; teleconsultationConsent: boolean },
  ): Promise<PatientWithAccount> {
    const now = new Date();
    return db.transaction(async (tx) => {
      if (await patients.existsByCpf(Cpf.create(input.cpf).value, tx)) {
        throw new ConflictError('CPF is already registered');
      }

      const user = await auth.createUser({ email: input.email, password: input.password, role: 'PATIENT' }, tx);
      const patient = Patient.create(
        {
          userId: user.id,
          name: input.name,
          cpf: input.cpf,
          birthDate: input.birthDate,
          phone: input.phone,
          address: input.address,
          acceptTerms: input.acceptTerms,
          termsVersion: config.termsVersion,
        },
        now,
      );
      await patients.insert(patient, tx);

      if (input.teleconsultationConsent) {
        await lgpd.grantConsent({ patientId: patient.id, purpose: 'TELECONSULTATION', termsVersion: config.termsVersion, at: now }, tx);
      }
      return { patient, account: { email: user.email, active: user.active } };
    });
  }

  async function register(input: RegisterPatientInput): Promise<PatientWithAccount> {
    return createWithAccount(input);
  }

  async function createByAdmin(input: CreatePatientInput): Promise<PatientWithAccount> {
    const created = await createWithAccount({ ...input, teleconsultationConsent: false });
    await auth.issuePasswordSetup(created.patient.userId);
    return created;
  }

  async function getById(id: string): Promise<PatientWithAccount> {
    const patient = await patients.findById(id);
    if (!patient) {
      throw new NotFoundError('Patient not found');
    }
    return withAccount(patient);
  }

  async function getByUserId(userId: string): Promise<PatientWithAccount> {
    const patient = await patients.findByUserId(userId);
    if (!patient) {
      throw new NotFoundError('Patient not found');
    }
    return withAccount(patient);
  }

  async function applyUpdate(patient: Patient, changes: UpdatePatientInput, tx: Transaction): Promise<PatientWithAccount> {
    patient.updateContactInfo(changes);
    if (changes.email !== undefined) {
      await auth.updateEmail(patient.userId, changes.email, tx);
    }
    await patients.update(patient, tx);
    return withAccount(patient, tx);
  }

  async function updateByUserId(userId: string, changes: UpdatePatientInput): Promise<PatientWithAccount> {
    return db.transaction(async (tx) => {
      const patient = await patients.findByUserIdForUpdate(userId, tx);
      if (!patient) {
        throw new NotFoundError('Patient not found');
      }
      return applyUpdate(patient, changes, tx);
    });
  }

  async function update(id: string, changes: UpdatePatientInput): Promise<PatientWithAccount> {
    return db.transaction(async (tx) => {
      const patient = await patients.findByIdForUpdate(id, tx);
      if (!patient) {
        throw new NotFoundError('Patient not found');
      }
      return applyUpdate(patient, changes, tx);
    });
  }

  async function correctIdentity(ctx: RequestContext, id: string, correction: IdentityCorrection): Promise<PatientWithAccount> {
    return db.transaction(async (tx) => {
      const patient = await patients.findByIdForUpdate(id, tx);
      if (!patient) {
        throw new NotFoundError('Patient not found');
      }
      if (correction.cpf !== undefined) {
        const cpf = Cpf.create(correction.cpf);
        if (!cpf.equals(patient.cpf) && (await patients.existsByCpf(cpf.value, tx))) {
          throw new ConflictError('CPF is already registered');
        }
      }

      patient.correctIdentity(correction);
      await patients.update(patient, tx);
      await audit.record(ctx, { action: 'CORRECT', resourceType: 'PATIENT', resourceId: patient.id, patientId: patient.id }, tx);
      return withAccount(patient, tx);
    });
  }

  async function setActive(ctx: RequestContext, id: string, active: boolean): Promise<void> {
    await db.transaction(async (tx) => {
      const patient = await patients.findById(id, tx);
      if (!patient) {
        throw new NotFoundError('Patient not found');
      }
      const changed = active ? await auth.activate(patient.userId, tx) : await auth.deactivate(patient.userId, tx);
      if (changed) {
        await audit.record(ctx, { action: 'UPDATE', resourceType: 'PATIENT', resourceId: patient.id, patientId: patient.id }, tx);
      }
    });
  }

  async function deactivate(ctx: RequestContext, id: string): Promise<void> {
    await setActive(ctx, id, false);
  }

  async function activate(ctx: RequestContext, id: string): Promise<void> {
    await setActive(ctx, id, true);
  }

  async function list(filters: PatientFilters, pagination: Pagination) {
    return patients.findMany(filters, pagination);
  }

  return { register, createByAdmin, getById, getByUserId, updateByUserId, update, correctIdentity, deactivate, activate, list };
}
