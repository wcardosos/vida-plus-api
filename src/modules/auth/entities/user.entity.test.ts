import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import type { Role } from '../../../shared/roles';
import { Email, User, type CreateUserProps, type UserProps } from '../entities/user.entity';

const now = new Date('2026-10-11T12:00:00.000Z');

function validProps(overrides: Partial<CreateUserProps> = {}): CreateUserProps {
  return { email: 'maria@vidaplus.com', passwordHash: '$argon2id$hash', role: 'PATIENT', ...overrides };
}

function storedProps(overrides: Partial<UserProps> = {}): UserProps {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'maria@vidaplus.com',
    passwordHash: '$argon2id$hash',
    role: 'PROFESSIONAL',
    active: true,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Email', () => {
  it('normalizes by trimming and lowercasing', () => {
    expect(Email.create('  Maria.Silva@VidaPlus.COM ').value).toBe('maria.silva@vidaplus.com');
  });

  it('considers addresses that differ only in case equal', () => {
    expect(Email.create('A@B.com').equals(Email.create('a@b.COM'))).toBe(true);
  });

  it.each(['', '   '])('rejects the blank address %j', (raw) => {
    expect(() => Email.create(raw)).toThrow(new DomainError('email is required'));
  });

  it.each(['maria', 'maria@', '@vidaplus.com', 'maria@vidaplus', 'ma ria@vidaplus.com'])('rejects the malformed address %j', (raw) => {
    expect(() => Email.create(raw)).toThrow(new DomainError('email must be a valid email address'));
  });

  it('rejects an address longer than 254 characters', () => {
    const raw = `${'a'.repeat(64)}@${'b'.repeat(186)}.com`;

    expect(raw).toHaveLength(255);
    expect(() => Email.create(raw)).toThrow(DomainError);
  });

  it('accepts an address of exactly 254 characters', () => {
    const raw = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;

    expect(Email.create(raw).value).toHaveLength(254);
  });
});

describe('User.create', () => {
  it('generates a UUID id and starts active with no login or password change', () => {
    const user = User.create(validProps(), now);

    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(user.active).toBe(true);
    expect(user.lastLoginAt).toBeNull();
    expect(user.passwordChangedAt).toBeNull();
    expect(user.createdAt).toEqual(now);
  });

  it('generates a different id for each user', () => {
    expect(User.create(validProps()).id).not.toBe(User.create(validProps()).id);
  });

  it('stores the normalized email', () => {
    expect(User.create(validProps({ email: ' Maria@VidaPlus.com ' })).email).toBe('maria@vidaplus.com');
  });

  it('keeps the given password hash and role', () => {
    const user = User.create(validProps({ role: 'ADMIN' }));

    expect(user.passwordHash).toBe('$argon2id$hash');
    expect(user.role).toBe('ADMIN');
  });

  it('rejects an invalid email', () => {
    expect(() => User.create(validProps({ email: 'not-an-email' }))).toThrow(DomainError);
  });

  it('rejects an empty password hash', () => {
    expect(() => User.create(validProps({ passwordHash: '' }))).toThrow(new DomainError('passwordHash is required'));
  });

  it('rejects an unknown role', () => {
    expect(() => User.create(validProps({ role: 'NURSE' as Role }))).toThrow(DomainError);
  });
});

describe('User.restore', () => {
  it('rebuilds the user without revalidating', () => {
    const props = storedProps({ email: 'legacy', active: false });

    const user = User.restore(props);

    expect(user).toBeInstanceOf(User);
    expect(user.email).toBe('legacy');
    expect(user.active).toBe(false);
    expect(user.id).toBe(props.id);
  });

  it('does not share state with the given props', () => {
    const props = storedProps();

    User.restore(props).recordLogin(now);

    expect(props.lastLoginAt).toBeNull();
  });
});

describe('User.recordLogin', () => {
  it('records the login time', () => {
    const user = User.restore(storedProps());

    user.recordLogin(now);

    expect(user.lastLoginAt).toEqual(now);
  });

  it('rejects an inactive account', () => {
    const user = User.restore(storedProps({ active: false }));

    expect(() => user.recordLogin(now)).toThrow(new DomainError('User account is inactive'));
    expect(user.lastLoginAt).toBeNull();
  });
});

describe('User.changePassword', () => {
  it('replaces the hash and records when it changed', () => {
    const user = User.restore(storedProps());

    user.changePassword('$argon2id$new', now);

    expect(user.passwordHash).toBe('$argon2id$new');
    expect(user.passwordChangedAt).toEqual(now);
  });

  it('rejects an inactive account', () => {
    const user = User.restore(storedProps({ active: false }));

    expect(() => user.changePassword('$argon2id$new', now)).toThrow(new DomainError('User account is inactive'));
    expect(user.passwordHash).toBe('$argon2id$hash');
  });

  it('rejects an empty hash', () => {
    expect(() => User.restore(storedProps()).changePassword('', now)).toThrow(DomainError);
  });
});

describe('User.deactivate', () => {
  it('makes the account unable to authenticate', () => {
    const user = User.restore(storedProps());

    user.deactivate();

    expect(user.active).toBe(false);
    expect(user.canAuthenticate()).toBe(false);
  });

  it('is idempotent', () => {
    const user = User.restore(storedProps({ active: false }));

    expect(() => user.deactivate()).not.toThrow();
    expect(user.active).toBe(false);
  });
});

describe('User.canAuthenticate', () => {
  it('is true for an active account', () => {
    expect(User.restore(storedProps()).canAuthenticate()).toBe(true);
  });
});

describe('User.wasTokenIssuedBeforePasswordChange', () => {
  it('is false when the password never changed', () => {
    expect(User.restore(storedProps()).wasTokenIssuedBeforePasswordChange(new Date(0))).toBe(false);
  });

  it('is true for a token issued in an earlier second', () => {
    const user = User.restore(storedProps({ passwordChangedAt: new Date('2026-10-11T12:00:00.400Z') }));

    expect(user.wasTokenIssuedBeforePasswordChange(new Date('2026-10-11T11:59:59.000Z'))).toBe(true);
  });

  it('is false for a token issued after the change', () => {
    const user = User.restore(storedProps({ passwordChangedAt: new Date('2026-10-11T12:00:00.400Z') }));

    expect(user.wasTokenIssuedBeforePasswordChange(new Date('2026-10-11T12:00:01.000Z'))).toBe(false);
  });

  it('is false for a token whose whole-second iat falls in the same second as the change', () => {
    const user = User.restore(storedProps({ passwordChangedAt: new Date('2026-10-11T12:00:00.900Z') }));

    expect(user.wasTokenIssuedBeforePasswordChange(new Date('2026-10-11T12:00:00.000Z'))).toBe(false);
  });
});
