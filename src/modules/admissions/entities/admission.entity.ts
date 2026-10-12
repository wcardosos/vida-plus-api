import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { AdmissionMovement } from './admission-movement.entity';
import type { Bed } from './bed.entity';

export const admissionStatuses = ['ACTIVE', 'DISCHARGED'] as const;

export type AdmissionStatus = (typeof admissionStatuses)[number];

export type AdmissionProps = {
  id: string;
  patientId: string;
  unitId: string;
  currentBedId: string;
  responsibleProfessionalId: string;
  status: AdmissionStatus;
  admittedAt: Date;
  dischargedAt: Date | null;
  movements: AdmissionMovement[];
};

export type AdmitProps = {
  patientId: string;
  responsibleProfessionalId: string;
  bed: Bed;
};

export class Admission {
  private constructor(private readonly props: AdmissionProps) {}

  static admit(props: AdmitProps, now: Date): Admission {
    for (const field of ['patientId', 'responsibleProfessionalId'] as const) {
      if (!props[field]) {
        throw new DomainError(`${field} is required`);
      }
    }
    if (!props.bed) {
      throw new DomainError('bed is required');
    }
    const id = randomUUID();
    const movement = AdmissionMovement.record({ admissionId: id, type: 'ADMISSION', toBedId: props.bed.id }, now);
    props.bed.occupy();

    return new Admission({
      id,
      patientId: props.patientId,
      unitId: props.bed.unitId,
      currentBedId: props.bed.id,
      responsibleProfessionalId: props.responsibleProfessionalId,
      status: 'ACTIVE',
      admittedAt: now,
      dischargedAt: null,
      movements: [movement],
    });
  }

  static restore(props: AdmissionProps): Admission {
    const movements = [...props.movements].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    return new Admission({ ...props, movements });
  }

  get id() {
    return this.props.id;
  }

  get patientId() {
    return this.props.patientId;
  }

  get unitId() {
    return this.props.unitId;
  }

  get currentBedId() {
    return this.props.currentBedId;
  }

  get responsibleProfessionalId() {
    return this.props.responsibleProfessionalId;
  }

  get status() {
    return this.props.status;
  }

  get admittedAt() {
    return this.props.admittedAt;
  }

  get dischargedAt() {
    return this.props.dischargedAt;
  }

  getMovements(): AdmissionMovement[] {
    return [...this.props.movements];
  }

  isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }

  isResponsible(professionalId: string): boolean {
    return this.props.responsibleProfessionalId === professionalId;
  }

  private ensureActive(): void {
    if (!this.isActive()) {
      throw new DomainError(`Admission is ${this.props.status} and cannot be changed`);
    }
  }

  private ensureCurrentBed(bed: Bed): void {
    if (bed.id !== this.props.currentBedId) {
      throw new DomainError('Bed is not the current bed of the admission');
    }
  }

  ensureCanMoveTo(bed: Bed): void {
    this.ensureActive();
    if (bed.id === this.props.currentBedId) {
      throw new DomainError('Patient is already in this bed');
    }
    if (bed.unitId !== this.props.unitId) {
      throw new DomainError('Transfers are only allowed between beds of the same unit; discharge and admit in the other unit instead');
    }
  }

  transfer(from: Bed, to: Bed, now: Date): void {
    this.ensureCanMoveTo(to);
    this.ensureCurrentBed(from);
    if (!from.isOccupied()) {
      throw new DomainError(`Bed is ${from.status} and cannot be released`);
    }
    const movement = AdmissionMovement.record({ admissionId: this.props.id, type: 'TRANSFER', fromBedId: from.id, toBedId: to.id }, now);
    to.occupy();
    from.release();

    this.props.currentBedId = to.id;
    this.props.movements.push(movement);
  }

  discharge(bed: Bed, now: Date): void {
    this.ensureActive();
    this.ensureCurrentBed(bed);
    const movement = AdmissionMovement.record({ admissionId: this.props.id, type: 'DISCHARGE', fromBedId: bed.id }, now);
    bed.release();

    this.props.status = 'DISCHARGED';
    this.props.dischargedAt = now;
    this.props.movements.push(movement);
  }

  ensureAcceptsMedicalRecord(): void {
    if (!this.isActive()) {
      throw new DomainError(`Admission is ${this.props.status} and does not accept medical records`);
    }
  }
}
