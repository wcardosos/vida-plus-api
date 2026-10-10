import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { DomainError } from '../../shared/errors';

export const auditActions = ['READ', 'CREATE', 'UPDATE', 'CORRECT', 'EXPORT', 'ACCESS_DENIED'] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditResourceTypes = ['MEDICAL_RECORD_ENTRY', 'PRESCRIPTION', 'EXAM', 'ADMISSION', 'PATIENT'] as const;
export type AuditResourceType = (typeof auditResourceTypes)[number];

export type AuditLogProps = {
  id: string;
  userId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  patientId: string | null;
  ip: string;
  occurredAt: Date;
};

export type RecordAuditLogProps = {
  userId: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  patientId?: string | null;
  ip: string;
};

const requiredFields = ['userId', 'action', 'resourceType', 'resourceId', 'ip'] as const;

export class AuditLog {
  readonly id: string;
  readonly userId: string;
  readonly action: AuditAction;
  readonly resourceType: AuditResourceType;
  readonly resourceId: string;
  readonly patientId: string | null;
  readonly ip: string;
  readonly occurredAt: Date;

  private constructor(props: AuditLogProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.action = props.action;
    this.resourceType = props.resourceType;
    this.resourceId = props.resourceId;
    this.patientId = props.patientId;
    this.ip = props.ip;
    this.occurredAt = props.occurredAt;
  }

  static record(props: RecordAuditLogProps, now: Date): AuditLog {
    for (const field of requiredFields) {
      if (!props[field]) {
        throw new DomainError(`${field} is required`);
      }
    }
    if (!auditActions.includes(props.action)) {
      throw new DomainError(`action must be one of ${auditActions.join(', ')}`);
    }
    if (!auditResourceTypes.includes(props.resourceType)) {
      throw new DomainError(`resourceType must be one of ${auditResourceTypes.join(', ')}`);
    }
    if (isIP(props.ip) === 0) {
      throw new DomainError('ip must be a valid IPv4 or IPv6 address');
    }

    return new AuditLog({
      id: randomUUID(),
      userId: props.userId,
      action: props.action,
      resourceType: props.resourceType,
      resourceId: props.resourceId,
      patientId: props.patientId ?? null,
      ip: props.ip,
      occurredAt: now,
    });
  }

  static restore(props: AuditLogProps): AuditLog {
    return new AuditLog(props);
  }
}
