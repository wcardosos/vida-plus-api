import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { requiredText } from './medical-record-entry.entity';

export type PrescriptionItemInput = {
  medication: string;
  dose: string;
  dosageInstructions: string;
  duration: string;
};

export type PrescriptionItemProps = PrescriptionItemInput & {
  id: string;
  position: number;
};

export class PrescriptionItem {
  static readonly medicationMaxLength = 200;
  static readonly doseMaxLength = 100;
  static readonly dosageInstructionsMaxLength = 500;
  static readonly durationMaxLength = 100;

  private constructor(private readonly props: PrescriptionItemProps) {}

  static create(input: PrescriptionItemInput, position: number): PrescriptionItem {
    if (!Number.isInteger(position) || position < 1) {
      throw new DomainError('position must be a positive integer');
    }
    const field = (name: string) => `items[${position - 1}].${name}`;
    return new PrescriptionItem({
      id: randomUUID(),
      position,
      medication: requiredText(field('medication'), input?.medication, PrescriptionItem.medicationMaxLength),
      dose: requiredText(field('dose'), input?.dose, PrescriptionItem.doseMaxLength),
      dosageInstructions: requiredText(field('dosageInstructions'), input?.dosageInstructions, PrescriptionItem.dosageInstructionsMaxLength),
      duration: requiredText(field('duration'), input?.duration, PrescriptionItem.durationMaxLength),
    });
  }

  static restore(props: PrescriptionItemProps): PrescriptionItem {
    return new PrescriptionItem({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get position() {
    return this.props.position;
  }

  get medication() {
    return this.props.medication;
  }

  get dose() {
    return this.props.dose;
  }

  get dosageInstructions() {
    return this.props.dosageInstructions;
  }

  get duration() {
    return this.props.duration;
  }
}
