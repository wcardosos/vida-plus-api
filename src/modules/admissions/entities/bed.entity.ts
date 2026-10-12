import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export const bedTypes = ['ICU', 'WARD'] as const;

export type BedType = (typeof bedTypes)[number];

export const bedStatuses = ['AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE'] as const;

export type BedStatus = (typeof bedStatuses)[number];

export const manualBedStatuses = ['AVAILABLE', 'MAINTENANCE'] as const;

export type ManualBedStatus = (typeof manualBedStatuses)[number];

export type BedProps = {
  id: string;
  unitId: string;
  identification: string;
  sector: string;
  type: BedType;
  status: BedStatus;
  createdAt: Date;
};

export type CreateBedProps = {
  unitId: string;
  identification: string;
  sector: string;
  type: BedType;
};

export type UpdateBedProps = {
  identification?: string;
  sector?: string;
  type?: BedType;
};

function requiredText(field: string, raw: unknown, maxLength: number): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw new DomainError(`${field} is required`);
  }
  if (value.length > maxLength) {
    throw new DomainError(`${field} must have at most ${maxLength} characters`);
  }
  return value;
}

function validType(type: unknown): BedType {
  if (!bedTypes.includes(type as BedType)) {
    throw new DomainError(`type must be one of ${bedTypes.join(', ')}`);
  }
  return type as BedType;
}

export class Bed {
  static readonly identificationMaxLength = 20;
  static readonly sectorMaxLength = 60;

  private constructor(private readonly props: BedProps) {}

  static create(props: CreateBedProps, now: Date = new Date()): Bed {
    if (!props.unitId) {
      throw new DomainError('unitId is required');
    }
    return new Bed({
      id: randomUUID(),
      unitId: props.unitId,
      identification: requiredText('identification', props.identification, Bed.identificationMaxLength),
      sector: requiredText('sector', props.sector, Bed.sectorMaxLength),
      type: validType(props.type),
      status: 'AVAILABLE',
      createdAt: now,
    });
  }

  static restore(props: BedProps): Bed {
    return new Bed({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get unitId() {
    return this.props.unitId;
  }

  get identification() {
    return this.props.identification;
  }

  get sector() {
    return this.props.sector;
  }

  get type() {
    return this.props.type;
  }

  get status() {
    return this.props.status;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  isAvailable(): boolean {
    return this.props.status === 'AVAILABLE';
  }

  isOccupied(): boolean {
    return this.props.status === 'OCCUPIED';
  }

  private ensureNotOccupied(action: string): void {
    if (this.isOccupied()) {
      throw new DomainError(`Bed is OCCUPIED and cannot ${action}; it changes only through the admission`);
    }
  }

  update(changes: UpdateBedProps): void {
    this.ensureNotOccupied('be edited');
    const next = {
      identification:
        changes.identification === undefined
          ? this.props.identification
          : requiredText('identification', changes.identification, Bed.identificationMaxLength),
      sector: changes.sector === undefined ? this.props.sector : requiredText('sector', changes.sector, Bed.sectorMaxLength),
      type: changes.type === undefined ? this.props.type : validType(changes.type),
    };
    Object.assign(this.props, next);
  }

  occupy(): void {
    if (!this.isAvailable()) {
      throw new DomainError(`Bed is ${this.props.status} and cannot be occupied`);
    }
    this.props.status = 'OCCUPIED';
  }

  release(): void {
    if (!this.isOccupied()) {
      throw new DomainError(`Bed is ${this.props.status} and cannot be released`);
    }
    this.props.status = 'CLEANING';
  }

  markAvailable(): void {
    this.ensureNotOccupied('change status manually');
    this.props.status = 'AVAILABLE';
  }

  markMaintenance(): void {
    this.ensureNotOccupied('change status manually');
    this.props.status = 'MAINTENANCE';
  }

  changeStatus(status: ManualBedStatus): void {
    if (status === 'AVAILABLE') {
      this.markAvailable();
    } else if (status === 'MAINTENANCE') {
      this.markMaintenance();
    } else {
      throw new DomainError(`status must be one of ${manualBedStatuses.join(', ')}`);
    }
  }
}
