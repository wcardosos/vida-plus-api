import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { LgpdConsent, type ConsentPurpose } from './lgpd-consent.entity';

const now = new Date('2026-10-11T12:00:00.000Z');
const patientId = '11111111-1111-4111-8111-111111111111';

describe('LgpdConsent.grant', () => {
  it('records the purpose, the terms version and when it was granted', () => {
    const consent = LgpdConsent.grant(patientId, 'TELECONSULTATION', '2026-10', now);

    expect(consent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(consent.patientId).toBe(patientId);
    expect(consent.purpose).toBe('TELECONSULTATION');
    expect(consent.termsVersion).toBe('2026-10');
    expect(consent.grantedAt).toEqual(now);
    expect(consent.revokedAt).toBeNull();
  });

  it('requires a patient', () => {
    expect(() => LgpdConsent.grant('', 'TELECONSULTATION', '2026-10', now)).toThrow(new DomainError('patientId is required'));
  });

  it('rejects an unknown purpose', () => {
    expect(() => LgpdConsent.grant(patientId, 'MARKETING' as ConsentPurpose, '2026-10', now)).toThrow(DomainError);
  });

  it.each(['', '  ', 'v'.repeat(21)])('rejects the terms version %j', (termsVersion) => {
    expect(() => LgpdConsent.grant(patientId, 'TELECONSULTATION', termsVersion, now)).toThrow(DomainError);
  });
});

describe('LgpdConsent.restore', () => {
  it('rebuilds a revoked consent without revalidating', () => {
    const revokedAt = new Date('2026-10-12T00:00:00.000Z');

    const consent = LgpdConsent.restore({
      id: 'legacy',
      patientId,
      purpose: 'TELECONSULTATION',
      termsVersion: '',
      grantedAt: now,
      revokedAt,
    });

    expect(consent.termsVersion).toBe('');
    expect(consent.revokedAt).toEqual(revokedAt);
  });
});
