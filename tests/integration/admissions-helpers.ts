import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/client';
import { Admission } from '../../src/modules/admissions/entities/admission.entity';
import { Bed, type BedStatus, type BedType } from '../../src/modules/admissions/entities/bed.entity';
import { createAdmissionRepository } from '../../src/modules/admissions/repositories/admission.repository';
import { createBedRepository } from '../../src/modules/admissions/repositories/bed.repository';
import { admissionMovements, admissions, beds } from '../../src/modules/admissions/schema';
import type { Unit } from '../../src/modules/units/entities/unit.entity';
import { insertPatient, insertProfessional, insertUnit, signToken, tokenFor } from './helpers';
import { now } from './scheduling-helpers';

const bedRepository = createBedRepository(db);
const admissionRepository = createAdmissionRepository(db);

let ticks = 0;

export const advancingClock = () => {
  ticks += 1;
  return new Date(now.getTime() + ticks * 1000);
};

export type InsertBedOptions = {
  identification?: string;
  sector?: string;
  type?: BedType;
  status?: BedStatus;
};

let bedCounter = 0;

export async function insertBed(unit: Pick<Unit, 'id'>, options: InsertBedOptions = {}): Promise<Bed> {
  bedCounter += 1;
  const bed = Bed.restore({
    id: randomUUID(),
    unitId: unit.id,
    identification: options.identification ?? `LEITO-${bedCounter}`,
    sector: options.sector ?? 'Clínica médica, 2º andar',
    type: options.type ?? 'WARD',
    status: options.status ?? 'AVAILABLE',
    createdAt: new Date(),
  });
  await bedRepository.insert(bed);
  return bed;
}

export async function insertAdmission(props: { patientId: string; responsibleProfessionalId: string; bed: Bed }, admittedAt: Date = now): Promise<Admission> {
  const admission = Admission.admit(props, admittedAt);
  await db.transaction(async (tx) => {
    await admissionRepository.insert(admission, tx);
    await bedRepository.update(props.bed, tx);
  });
  return admission;
}

export async function dischargeAdmission(admission: Admission, bed: Bed, at: Date = now): Promise<void> {
  admission.discharge(bed, at);
  await db.transaction(async (tx) => {
    await admissionRepository.update(admission, tx);
    await bedRepository.update(bed, tx);
  });
}

export async function hospital(app: FastifyInstance) {
  const unit = await insertUnit({ name: 'Hospital Central', type: 'HOSPITAL' });
  const responsible = await insertProfessional({ unitIds: [unit.id], name: 'Dra. Ana Lima' });
  const patient = await insertPatient({ name: 'Maria da Silva' });
  const bed = await insertBed(unit, { identification: 'ENF-01' });
  const otherBed = await insertBed(unit, { identification: 'ENF-02' });
  return {
    unit,
    bed,
    otherBed,
    responsible: { ...responsible, token: signToken(app, responsible.user) },
    patient: { ...patient, token: signToken(app, patient.user) },
    adminToken: await tokenFor(app, 'ADMIN'),
  };
}

export async function bedStatus(id: string): Promise<BedStatus> {
  const [row] = await db.select({ status: beds.status }).from(beds).where(eq(beds.id, id));
  return row.status;
}

export async function findAdmissionRows() {
  return db.select().from(admissions);
}

export async function findMovementRows() {
  return db.select().from(admissionMovements);
}
