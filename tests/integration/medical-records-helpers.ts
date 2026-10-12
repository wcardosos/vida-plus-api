import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/client';
import { env } from '../../src/env';
import { MedicalRecordEntry, type CreateMedicalRecordEntryProps } from '../../src/modules/medical-records/entities/medical-record-entry.entity';
import type { PrescriptionItemInput } from '../../src/modules/medical-records/entities/prescription-item.entity';
import { Prescription } from '../../src/modules/medical-records/entities/prescription.entity';
import { createMedicalRecordEntryRepository } from '../../src/modules/medical-records/repositories/medical-record-entry.repository';
import { createPrescriptionRepository } from '../../src/modules/medical-records/repositories/prescription.repository';
import { medicalRecordEntries, prescriptionItems, prescriptions } from '../../src/modules/medical-records/schema';
import type { ProfessionalCategory } from '../../src/modules/professionals/entities/professional.entity';
import type { Appointment, AppointmentProps } from '../../src/modules/scheduling/entities/appointment.entity';
import { appointments } from '../../src/modules/scheduling/schema';
import { createFieldCipher } from '../../src/shared/crypto';
import { insertAppointment, insertPatient, insertProfessional, insertUnit, signToken } from './helpers';
import { now } from './scheduling-helpers';

export const cipher = createFieldCipher(env.CLINICAL_DATA_KEY);

const entryRepository = createMedicalRecordEntryRepository(db, cipher);
const prescriptionRepository = createPrescriptionRepository(db, cipher);

export const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

export function itemBody(overrides: Partial<PrescriptionItemInput> = {}): PrescriptionItemInput {
  return {
    medication: 'Salbutamol 100 mcg',
    dose: '2 jatos',
    dosageInstructions: 'de 6 em 6 horas se falta de ar',
    duration: '15 dias',
    ...overrides,
  };
}

export function prescriptionBody(overrides: Record<string, unknown> = {}) {
  return { validUntil: '2026-11-12', items: [itemBody()], ...overrides };
}

export function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    anamnesis: 'Paciente relata tosse seca há 5 dias',
    icdCode: 'J45.0',
    diagnosisNotes: 'Asma com predominância alérgica',
    conduct: 'Broncodilatador, retorno em 15 dias',
    ...overrides,
  };
}

export function correctionBody(overrides: Record<string, unknown> = {}) {
  return {
    anamnesis: 'Paciente relata tosse seca há 7 dias',
    icdCode: 'J45.1',
    diagnosisNotes: null,
    conduct: 'Broncodilatador e corticoide inalatório',
    correctionReason: 'Duração dos sintomas registrada errada',
    ...overrides,
  };
}

export async function insertProfessionalWithToken(app: FastifyInstance, unitId: string, category: ProfessionalCategory = 'PHYSICIAN', name?: string) {
  const { professional, user } = await insertProfessional({ unitIds: [unitId], category, name });
  return { professional, user, token: signToken(app, user) };
}

export async function insertPatientWithToken(app: FastifyInstance, name?: string) {
  const { patient, user } = await insertPatient({ name });
  return { patient, user, token: signToken(app, user) };
}

export async function attendance(app: FastifyInstance, appointment: Partial<AppointmentProps> = {}, category: ProfessionalCategory = 'PHYSICIAN') {
  const unit = await insertUnit({ name: 'Unidade Centro' });
  const professional = await insertProfessionalWithToken(app, unit.id, category, 'Dra. Ana Lima');
  const patient = await insertPatientWithToken(app, 'Maria da Silva');
  const created = await insertAppointment({
    patientId: patient.patient.id,
    professionalId: professional.professional.id,
    unitId: unit.id,
    startsAt: minutesFromNow(-5),
    ...appointment,
  });
  return { unit, professional, patient, appointment: created };
}

export async function insertEntry(
  props: Pick<CreateMedicalRecordEntryProps, 'patientId' | 'professionalId' | 'appointmentId'> & Partial<CreateMedicalRecordEntryProps>,
  createdAt: Date = now,
): Promise<MedicalRecordEntry> {
  const entry = MedicalRecordEntry.create({ ...entryBody(), ...props }, createdAt);
  await entryRepository.insert(entry);
  return entry;
}

export async function insertCorrection(original: MedicalRecordEntry, createdAt: Date = now, overrides: Record<string, unknown> = {}) {
  const correction = original.correct({ ...correctionBody(), ...overrides } as Parameters<MedicalRecordEntry['correct']>[0], createdAt);
  await entryRepository.insert(correction);
  return correction;
}

export async function insertPrescription(
  entry: MedicalRecordEntry,
  prescriber: { id: string; canPrescribe(): boolean },
  issuedAt: Date = now,
  validUntil = '2026-12-31',
): Promise<Prescription> {
  const prescription = Prescription.issue(
    { medicalRecordEntryId: entry.id, patientId: entry.patientId, prescriber, validUntil, items: [itemBody()] },
    issuedAt,
    env.APP_TIMEZONE,
  );
  await prescriptionRepository.insert(prescription);
  return prescription;
}

export async function findEntryRows() {
  return db.select().from(medicalRecordEntries);
}

export async function findEntryRow(id: string) {
  const [row] = await db.select().from(medicalRecordEntries).where(eq(medicalRecordEntries.id, id));
  return row;
}

export async function findPrescriptionRows() {
  return db.select().from(prescriptions);
}

export async function findPrescriptionItemRows() {
  return db.select().from(prescriptionItems);
}

export async function appointmentStatus(appointment: Appointment) {
  const [row] = await db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, appointment.id));
  return row.status;
}
