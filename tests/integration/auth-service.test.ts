import argon2 from 'argon2';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createContainer } from '../../src/container';
import { db, pool } from '../../src/db/client';
import { User } from '../../src/modules/auth/user.entity';
import { createUserRepository } from '../../src/modules/auth/user.repository';
import { ConflictError } from '../../src/shared/errors';
import { captureEmails, clearUsers, findUsers } from './helpers';

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
