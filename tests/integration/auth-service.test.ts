import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createContainer } from '../../src/container';
import { db, pool } from '../../src/db/client';
import { env } from '../../src/env';
import { User } from '../../src/modules/auth/entities/user.entity';
import { createUserRepository } from '../../src/modules/auth/repositories/user.repository';
import { ConflictError, NotFoundError } from '../../src/shared/errors';
import { captureEmails, clearUsers, findPasswordResetTokens, findUsers, insertUser } from './helpers';

const { services } = createContainer({ db, logger: pino({ level: 'silent' }), emailSender: captureEmails().sender });
const authService = services.auth;

class Rollback extends Error {}

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await clearUsers();
});

describe('authService.createUser', () => {
  it('persists the user with a normalized email and an argon2id hash', async () => {
    const user = await authService.createUser({ email: ' Ana@VidaPlus.com ', password: 'a strong password', role: 'PROFESSIONAL' });

    const [row] = await findUsers();
    expect(row).toMatchObject({ id: user.id, email: 'ana@vidaplus.com', role: 'PROFESSIONAL', active: true });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain('a strong password');
    expect(await argon2.verify(row.passwordHash, 'a strong password')).toBe(true);
  });

  it('rejects an email already in use regardless of case', async () => {
    await authService.createUser({ email: 'ana@vidaplus.com', password: 'a strong password', role: 'PATIENT' });

    await expect(authService.createUser({ email: 'ANA@vidaplus.com', password: 'another password', role: 'PATIENT' })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await findUsers()).toHaveLength(1);
  });

  it('relies on the unique index when the pre-check is bypassed', async () => {
    const repository = createUserRepository(db);
    await repository.insert(User.create({ email: 'ana@vidaplus.com', passwordHash: 'hash', role: 'PATIENT' }));

    await expect(repository.insert(User.create({ email: 'ana@vidaplus.com', passwordHash: 'hash', role: 'ADMIN' }))).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });

  it('commits with the caller transaction', async () => {
    await db.transaction(async (tx) => {
      await authService.createUser({ email: 'ana@vidaplus.com', password: 'a strong password', role: 'PATIENT' }, tx);
    });

    expect(await findUsers()).toHaveLength(1);
  });

  it('leaves no user when the caller transaction rolls back', async () => {
    await expect(
      db.transaction(async (tx) => {
        await authService.createUser({ email: 'ana@vidaplus.com', password: 'a strong password', role: 'PATIENT' }, tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(await findUsers()).toEqual([]);
  });
});

describe('authService.ensureAdmin', () => {
  it('creates the administrator once and is idempotent afterwards', async () => {
    const first = await authService.ensureAdmin({ email: 'admin@vidaplus.com', password: 'admin password' });
    const second = await authService.ensureAdmin({ email: 'Admin@VidaPlus.com', password: 'other password' });

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false });
    expect(second.user.id).toBe(first.user.id);
    const rows = await findUsers();
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('ADMIN');
    expect(await argon2.verify(rows[0].passwordHash, 'admin password')).toBe(true);
  });
});

describe('authService.createUser without a password', () => {
  it('stores the hash of a random password nobody knows', async () => {
    const user = await authService.createUser({ email: 'ana@vidaplus.com', role: 'PROFESSIONAL' });

    const [row] = await findUsers();
    expect(row).toMatchObject({ id: user.id, active: true });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe('authService.updateEmail', () => {
  it('changes the email and invalidates pending password tokens', async () => {
    const user = await insertUser({ email: 'old@vidaplus.com' });
    await authService.issuePasswordSetup(user.id);

    await authService.updateEmail(user.id, ' New@VidaPlus.com ');

    expect((await findUsers())[0].email).toBe('new@vidaplus.com');
    expect((await findPasswordResetTokens()).every((token) => token.usedAt !== null)).toBe(true);
  });

  it('rejects an email used by another account', async () => {
    const user = await insertUser({ email: 'ana@vidaplus.com' });
    await insertUser({ email: 'taken@vidaplus.com' });

    await expect(authService.updateEmail(user.id, 'taken@vidaplus.com')).rejects.toBeInstanceOf(ConflictError);
  });

  it('is rolled back with the caller transaction', async () => {
    const user = await insertUser({ email: 'ana@vidaplus.com' });

    await expect(
      db.transaction(async (tx) => {
        await authService.updateEmail(user.id, 'new@vidaplus.com', tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect((await findUsers())[0].email).toBe('ana@vidaplus.com');
  });

  it('throws NotFoundError for an unknown user', async () => {
    await expect(authService.updateEmail(randomUUID(), 'new@vidaplus.com')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('authService.deactivate and activate', () => {
  it('report whether the status actually changed', async () => {
    const user = await insertUser();

    expect(await authService.deactivate(user.id)).toBe(true);
    expect(await authService.deactivate(user.id)).toBe(false);
    expect((await findUsers())[0].active).toBe(false);
    expect(await authService.activate(user.id)).toBe(true);
    expect(await authService.activate(user.id)).toBe(false);
    expect((await findUsers())[0].active).toBe(true);
  });
});

describe('authService.issuePasswordSetup', () => {
  it('stores a token valid for the setup ttl and emails the link', async () => {
    const emails = captureEmails();
    const { services: isolated } = createContainer({ db, logger: pino({ level: 'silent' }), emailSender: emails.sender });
    const user = await insertUser({ email: 'ana@vidaplus.com' });

    await isolated.auth.issuePasswordSetup(user.id);

    const [token] = await findPasswordResetTokens();
    expect(token.userId).toBe(user.id);
    expect(token.expiresAt.getTime() - token.createdAt.getTime()).toBe(env.PASSWORD_SETUP_TOKEN_TTL);
    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0].text).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]{43}/);
  });

  it('does not throw when the user does not exist', async () => {
    await expect(authService.issuePasswordSetup(randomUUID())).resolves.toBeUndefined();
    expect(await findPasswordResetTokens()).toHaveLength(0);
  });
});
