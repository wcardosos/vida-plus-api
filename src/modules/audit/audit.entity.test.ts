import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/errors';
import { AuditLog, type AuditLogProps, type RecordAuditLogProps } from './audit.entity';

const now = new Date('2026-03-10T14:30:00.000Z');

function validProps(overrides: Partial<RecordAuditLogProps> = {}): RecordAuditLogProps {
  return {
    userId: randomUUID(),
    action: 'READ',
    resourceType: 'PATIENT',
    resourceId: randomUUID(),
    patientId: randomUUID(),
    ip: '203.0.113.7',
    ...overrides,
  };
}

describe('AuditLog.record', () => {
  it('creates the log with a UUID id and occurredAt equal to now', () => {
    const props = validProps();

    const log = AuditLog.record(props, now);

    expect(log.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(log.occurredAt).toEqual(now);
    expect(log).toMatchObject(props);
  });

  it('generates a different id for each log', () => {
    expect(AuditLog.record(validProps(), now).id).not.toBe(AuditLog.record(validProps(), now).id);
  });

  it.each(['userId', 'action', 'resourceType', 'resourceId', 'ip'] as const)('rejects a missing %s', (field) => {
    const props = { ...validProps(), [field]: undefined } as unknown as RecordAuditLogProps;

    expect(() => AuditLog.record(props, now)).toThrow(new DomainError(`${field} is required`));
  });

  it.each(['userId', 'resourceId', 'ip'] as const)('rejects an empty %s', (field) => {
    expect(() => AuditLog.record(validProps({ [field]: '' }), now)).toThrow(DomainError);
  });

  it('rejects an unknown action', () => {
    const props = validProps({ action: 'DELETE' as RecordAuditLogProps['action'] });

    expect(() => AuditLog.record(props, now)).toThrow(DomainError);
  });

  it('rejects an unknown resource type', () => {
    const props = validProps({ resourceType: 'USER' as RecordAuditLogProps['resourceType'] });

    expect(() => AuditLog.record(props, now)).toThrow(DomainError);
  });

  it.each(['192.168.0.1', '::1', '2001:db8::8a2e:370:7334', '::ffff:192.0.2.1'])('accepts the IP address %s', (ip) => {
    expect(AuditLog.record(validProps({ ip }), now).ip).toBe(ip);
  });

  it.each(['localhost', '256.1.1.1', '10.0.0', '192.168.0.1/24', '2001:db8::g', ' 10.0.0.1'])('rejects the invalid IP address %j', (ip) => {
    expect(() => AuditLog.record(validProps({ ip }), now)).toThrow(new DomainError('ip must be a valid IPv4 or IPv6 address'));
  });

  it('stores null when patientId is absent', () => {
    const { patientId, ...props } = validProps();

    expect(AuditLog.record(props, now).patientId).toBeNull();
  });
});

describe('AuditLog.restore', () => {
  it('rebuilds the log without revalidating', () => {
    const props: AuditLogProps = {
      id: 'legacy-id',
      userId: 'anonymized',
      action: 'READ',
      resourceType: 'PATIENT',
      resourceId: randomUUID(),
      patientId: null,
      ip: 'not-an-ip',
      occurredAt: new Date('2020-01-01T00:00:00.000Z'),
    };

    const log = AuditLog.restore(props);

    expect(log).toBeInstanceOf(AuditLog);
    expect({ ...log }).toEqual(props);
  });
});

describe('AuditLog', () => {
  it('exposes no methods besides record and restore', () => {
    const instanceMethods = Object.getOwnPropertyNames(AuditLog.prototype).filter((name) => name !== 'constructor');
    const staticMethods = Object.getOwnPropertyNames(AuditLog).filter(
      (name) => typeof (AuditLog as unknown as Record<string, unknown>)[name] === 'function',
    );

    expect(instanceMethods).toEqual([]);
    expect(staticMethods.sort()).toEqual(['record', 'restore']);
  });
});
