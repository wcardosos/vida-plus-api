import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export type ScheduleBlockProps = {
  id: string;
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdAt: Date;
};

export type CreateScheduleBlockProps = {
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
};

export class ScheduleBlock {
  static readonly reasonMaxLength = 200;

  private constructor(private readonly props: ScheduleBlockProps) {}

  static create(props: CreateScheduleBlockProps, now: Date = new Date()): ScheduleBlock {
    if (!props.professionalId) {
      throw new DomainError('professionalId is required');
    }
    if (props.endsAt.getTime() <= props.startsAt.getTime()) {
      throw new DomainError('endsAt must be after startsAt');
    }
    const reason = typeof props.reason === 'string' ? props.reason.trim() : '';
    if (!reason) {
      throw new DomainError('reason is required');
    }
    if (reason.length > ScheduleBlock.reasonMaxLength) {
      throw new DomainError(`reason must have at most ${ScheduleBlock.reasonMaxLength} characters`);
    }

    return new ScheduleBlock({
      id: randomUUID(),
      professionalId: props.professionalId,
      startsAt: props.startsAt,
      endsAt: props.endsAt,
      reason,
      createdAt: now,
    });
  }

  static restore(props: ScheduleBlockProps): ScheduleBlock {
    return new ScheduleBlock({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get professionalId() {
    return this.props.professionalId;
  }

  get startsAt() {
    return this.props.startsAt;
  }

  get endsAt() {
    return this.props.endsAt;
  }

  get reason() {
    return this.props.reason;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  overlaps(startsAt: Date, endsAt: Date): boolean {
    return startsAt < this.props.endsAt && this.props.startsAt < endsAt;
  }
}
