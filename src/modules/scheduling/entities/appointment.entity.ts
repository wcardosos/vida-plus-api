import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export const modalities = ['IN_PERSON', 'TELECONSULTATION'] as const;

export type Modality = (typeof modalities)[number];

export const appointmentStatuses = ['SCHEDULED', 'CANCELED', 'COMPLETED', 'NO_SHOW'] as const;

export type AppointmentStatus = (typeof appointmentStatuses)[number];

export const cancellationActors = ['PATIENT', 'PROFESSIONAL'] as const;

export type CancellationActor = (typeof cancellationActors)[number];

const dayMs = 86_400_000;

export type AppointmentProps = {
  id: string;
  patientId: string;
  professionalId: string;
  unitId: string;
  modality: Modality;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  cancellationReason: string | null;
  canceledBy: CancellationActor | null;
  canceledAt: Date | null;
  createdAt: Date;
};

export type ScheduleAppointmentProps = {
  patientId: string;
  professionalId: string;
  unitId: string;
  modality: Modality;
  startsAt: Date;
  endsAt: Date;
};

export class Appointment {
  static readonly maxDaysAhead = 90;
  static readonly cancellationReasonMaxLength = 200;

  private constructor(private readonly props: AppointmentProps) {}

  static isSchedulableAt(startsAt: Date, now: Date): boolean {
    return startsAt.getTime() > now.getTime() && startsAt.getTime() <= now.getTime() + Appointment.maxDaysAhead * dayMs;
  }

  static schedule(props: ScheduleAppointmentProps, now: Date): Appointment {
    for (const field of ['patientId', 'professionalId', 'unitId'] as const) {
      if (!props[field]) {
        throw new DomainError(`${field} is required`);
      }
    }
    if (!modalities.includes(props.modality)) {
      throw new DomainError(`modality must be one of ${modalities.join(', ')}`);
    }
    if (props.endsAt.getTime() <= props.startsAt.getTime()) {
      throw new DomainError('endsAt must be after startsAt');
    }
    if (props.startsAt.getTime() <= now.getTime()) {
      throw new DomainError('startsAt must be in the future');
    }
    if (!Appointment.isSchedulableAt(props.startsAt, now)) {
      throw new DomainError(`startsAt must be at most ${Appointment.maxDaysAhead} days ahead`);
    }

    return new Appointment({
      id: randomUUID(),
      patientId: props.patientId,
      professionalId: props.professionalId,
      unitId: props.unitId,
      modality: props.modality,
      startsAt: props.startsAt,
      endsAt: props.endsAt,
      status: 'SCHEDULED',
      cancellationReason: null,
      canceledBy: null,
      canceledAt: null,
      createdAt: now,
    });
  }

  static restore(props: AppointmentProps): Appointment {
    return new Appointment({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get patientId() {
    return this.props.patientId;
  }

  get professionalId() {
    return this.props.professionalId;
  }

  get unitId() {
    return this.props.unitId;
  }

  get modality() {
    return this.props.modality;
  }

  get startsAt() {
    return this.props.startsAt;
  }

  get endsAt() {
    return this.props.endsAt;
  }

  get status() {
    return this.props.status;
  }

  get cancellationReason() {
    return this.props.cancellationReason;
  }

  get canceledBy() {
    return this.props.canceledBy;
  }

  get canceledAt() {
    return this.props.canceledAt;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  isTeleconsultation(): boolean {
    return this.props.modality === 'TELECONSULTATION';
  }

  isScheduled(): boolean {
    return this.props.status === 'SCHEDULED';
  }

  hasStarted(now: Date): boolean {
    return now.getTime() >= this.props.startsAt.getTime();
  }

  overlaps(startsAt: Date, endsAt: Date): boolean {
    return this.props.status !== 'CANCELED' && startsAt < this.props.endsAt && this.props.startsAt < endsAt;
  }

  private ensureScheduled(): void {
    if (!this.isScheduled()) {
      throw new DomainError(`Appointment is ${this.props.status} and cannot be changed`);
    }
  }

  cancel(reason: string, by: CancellationActor, now: Date): void {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed) {
      throw new DomainError('cancellationReason is required');
    }
    if (trimmed.length > Appointment.cancellationReasonMaxLength) {
      throw new DomainError(`cancellationReason must have at most ${Appointment.cancellationReasonMaxLength} characters`);
    }
    if (!cancellationActors.includes(by)) {
      throw new DomainError(`canceledBy must be one of ${cancellationActors.join(', ')}`);
    }
    this.ensureScheduled();
    if (this.hasStarted(now)) {
      throw new DomainError('Appointment has already started and can no longer be canceled');
    }

    this.props.status = 'CANCELED';
    this.props.cancellationReason = trimmed;
    this.props.canceledBy = by;
    this.props.canceledAt = now;
  }

  markNoShow(now: Date): void {
    this.ensureScheduled();
    if (!this.hasStarted(now)) {
      throw new DomainError('A no-show can only be marked after the appointment starts');
    }
    this.props.status = 'NO_SHOW';
  }

  complete(): void {
    this.ensureScheduled();
    this.props.status = 'COMPLETED';
  }
}
