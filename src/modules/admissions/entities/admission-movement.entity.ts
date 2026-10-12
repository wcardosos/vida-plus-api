import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export const movementTypes = ['ADMISSION', 'TRANSFER', 'DISCHARGE'] as const;

export type MovementType = (typeof movementTypes)[number];

export type AdmissionMovementProps = {
  id: string;
  admissionId: string;
  type: MovementType;
  fromBedId: string | null;
  toBedId: string | null;
  occurredAt: Date;
};

export type RecordAdmissionMovementProps = {
  admissionId: string;
  type: MovementType;
  fromBedId?: string | null;
  toBedId?: string | null;
};

export class AdmissionMovement {
  private constructor(private readonly props: AdmissionMovementProps) {}

  static record(props: RecordAdmissionMovementProps, now: Date): AdmissionMovement {
    if (!props.admissionId) {
      throw new DomainError('admissionId is required');
    }
    if (!movementTypes.includes(props.type)) {
      throw new DomainError(`type must be one of ${movementTypes.join(', ')}`);
    }
    const fromBedId = props.fromBedId || null;
    const toBedId = props.toBedId || null;
    if (props.type === 'ADMISSION' && (fromBedId !== null || toBedId === null)) {
      throw new DomainError('An ADMISSION movement requires only a destination bed');
    }
    if (props.type === 'DISCHARGE' && (fromBedId === null || toBedId !== null)) {
      throw new DomainError('A DISCHARGE movement requires only an origin bed');
    }
    if (props.type === 'TRANSFER' && (fromBedId === null || toBedId === null || fromBedId === toBedId)) {
      throw new DomainError('A TRANSFER movement requires different origin and destination beds');
    }

    return new AdmissionMovement({ id: randomUUID(), admissionId: props.admissionId, type: props.type, fromBedId, toBedId, occurredAt: now });
  }

  static restore(props: AdmissionMovementProps): AdmissionMovement {
    return new AdmissionMovement({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get admissionId() {
    return this.props.admissionId;
  }

  get type() {
    return this.props.type;
  }

  get fromBedId() {
    return this.props.fromBedId;
  }

  get toBedId() {
    return this.props.toBedId;
  }

  get occurredAt() {
    return this.props.occurredAt;
  }
}
