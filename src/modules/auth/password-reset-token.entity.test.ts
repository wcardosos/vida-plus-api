import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/errors';
import { PasswordResetToken, type PasswordResetTokenProps } from './password-reset-token.entity';

const now = new Date('2026-10-11T12:00:00.000Z');
const thirtyMinutes = 30 * 60_000;
const userId = '22222222-2222-4222-8222-222222222222';
const tokenHash = 'a'.repeat(64);

function storedProps(overrides: Partial<PasswordResetTokenProps> = {}): PasswordResetTokenProps {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    userId,
    tokenHash,
    expiresAt: new Date(now.getTime() + thirtyMinutes),
    usedAt: null,
    createdAt: now,
    ...overrides,
  };
}

describe('PasswordResetToken.issue', () => {
  it('sets expiresAt to now plus the ttl and starts unused', () => {
    const token = PasswordResetToken.issue(userId, tokenHash, now, thirtyMinutes);

    expect(token.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(token.userId).toBe(userId);
    expect(token.tokenHash).toBe(tokenHash);
    expect(token.expiresAt).toEqual(new Date('2026-10-11T12:30:00.000Z'));
    expect(token.usedAt).toBeNull();
    expect(token.createdAt).toEqual(now);
  });

  it('rejects a missing userId', () => {
    expect(() => PasswordResetToken.issue('', tokenHash, now, thirtyMinutes)).toThrow(new DomainError('userId is required'));
  });

  it.each(['', 'raw-token', 'A'.repeat(64), 'a'.repeat(63)])('rejects the token hash %j', (hash) => {
    expect(() => PasswordResetToken.issue(userId, hash, now, thirtyMinutes)).toThrow(DomainError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the ttl %s', (ttl) => {
    expect(() => PasswordResetToken.issue(userId, tokenHash, now, ttl)).toThrow(new DomainError('ttl must be a positive duration'));
  });
});

describe('PasswordResetToken.isValid', () => {
  it('is true before expiration while unused', () => {
    expect(PasswordResetToken.restore(storedProps()).isValid(new Date('2026-10-11T12:29:59.999Z'))).toBe(true);
  });

  it('is false at the expiration instant', () => {
    expect(PasswordResetToken.restore(storedProps()).isValid(new Date('2026-10-11T12:30:00.000Z'))).toBe(false);
  });

  it('is false once used', () => {
    expect(PasswordResetToken.restore(storedProps({ usedAt: now })).isValid(now)).toBe(false);
  });
});

describe('PasswordResetToken.markUsed', () => {
  it('records when it was used', () => {
    const token = PasswordResetToken.restore(storedProps());
    const at = new Date('2026-10-11T12:10:00.000Z');

    token.markUsed(at);

    expect(token.usedAt).toEqual(at);
    expect(token.isValid(at)).toBe(false);
  });

  it('rejects a token that was already used', () => {
    const token = PasswordResetToken.restore(storedProps({ usedAt: now }));

    expect(() => token.markUsed(now)).toThrow(new DomainError('Password reset token has already been used'));
  });

  it('rejects an expired token', () => {
    const token = PasswordResetToken.restore(storedProps());

    expect(() => token.markUsed(new Date('2026-10-11T12:30:00.000Z'))).toThrow(new DomainError('Password reset token has expired'));
    expect(token.usedAt).toBeNull();
  });
});

describe('PasswordResetToken.restore', () => {
  it('rebuilds a token without revalidating', () => {
    const token = PasswordResetToken.restore(storedProps({ tokenHash: 'legacy', expiresAt: new Date(0) }));

    expect(token).toBeInstanceOf(PasswordResetToken);
    expect(token.tokenHash).toBe('legacy');
  });
});
