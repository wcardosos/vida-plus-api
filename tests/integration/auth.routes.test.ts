import { createHash, createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { db, pool } from '../../src/db/client';
import { env } from '../../src/env';
import { PasswordResetToken } from '../../src/modules/auth/entities/password-reset-token.entity';
import type { User } from '../../src/modules/auth/entities/user.entity';
import { createPasswordResetTokenRepository } from '../../src/modules/auth/repositories/password-reset-token.repository';
import { passwordResetTokens, users } from '../../src/modules/auth/schema';
import { hashPassword } from '../../src/modules/auth/services/password';
import {
  captureEmails,
  clearUsers,
  findPasswordResetTokens,
  findUsers,
  insertUser,
  nextIp,
  signToken,
  type InsertUserOptions,
} from './helpers';

const password = 'correct horse battery';
const emails = captureEmails();
const app = buildApp({ emailSender: emails.sender });
const resetTokenRepository = createPasswordResetTokenRepository(db);
let passwordHash: string;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function post(url: string, payload: object, remoteAddress = nextIp()) {
  return app.inject({ method: 'POST', url, payload, remoteAddress });
}

function login(email: string, pass = password, remoteAddress?: string) {
  return post('/auth/login', { email, password: pass }, remoteAddress);
}

function me(token: string) {
  return app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } });
}

function decode(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

function insertUserWithPassword(options: InsertUserOptions = {}) {
  return insertUser({ passwordHash, ...options });
}

async function requestReset(user: User) {
  const response = await post('/auth/password/forgot', { email: user.email });
  expect(response.statusCode).toBe(202);
  const message = emails.sent.at(-1)!;
  const link = new URL(/https?:\/\/\S+/.exec(message.text)![0]);
  return link.searchParams.get('token')!;
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await clearUsers();
  emails.sent.length = 0;
});

describe('POST /auth/login', () => {
  it('returns a bearer token carrying only the user id and role', async () => {
    const user = await insertUserWithPassword({ role: 'PROFESSIONAL' });

    const response = await login(user.email);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: 3600 });
    const claims = decode(body.accessToken);
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'role', 'sub']);
    expect(claims).toMatchObject({ sub: user.id, role: 'PROFESSIONAL' });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(JSON.parse(Buffer.from(body.accessToken.split('.')[0], 'base64url').toString()).alg).toBe('HS256');
  });

  it('matches the email regardless of case', async () => {
    const user = await insertUserWithPassword({ email: 'joana@vidaplus.com' });

    const response = await login('Joana@VidaPlus.COM');

    expect(response.statusCode).toBe(200);
    expect(decode(response.json().accessToken).sub).toBe(user.id);
  });

  it('records the login time', async () => {
    const user = await insertUserWithPassword();
    const before = new Date();

    await login(user.email);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.lastLoginAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
  });

  it('responds 401 with the same message for a wrong password and an unknown email', async () => {
    const user = await insertUserWithPassword();

    const wrongPassword = await login(user.email, 'wrong password');
    const unknownEmail = await login('nobody@vidaplus.com');

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual({ message: 'Invalid email or password', error: 'Unauthorized', statusCode: 401 });
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
  });

  it('responds 422 to an inactive account with the right password', async () => {
    const user = await insertUserWithPassword({ active: false });

    const response = await login(user.email);

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('User account is inactive');
  });

  it('responds 401 to an inactive account with a wrong password', async () => {
    const user = await insertUserWithPassword({ active: false });

    expect((await login(user.email, 'wrong password')).statusCode).toBe(401);
  });

  it.each([
    ['email is missing', { password }],
    ['email is malformed', { email: 'maria', password }],
    ['password is missing', { email: 'maria@vidaplus.com' }],
    ['password is empty', { email: 'maria@vidaplus.com', password: '' }],
    ['password is longer than 128 characters', { email: 'maria@vidaplus.com', password: 'a'.repeat(129) }],
  ])('responds 400 when %s', async (_, payload) => {
    const response = await post('/auth/login', payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Request validation failed', statusCode: 400 });
  });

  it('responds 429 after too many attempts from the same IP', async () => {
    const ip = nextIp();
    for (let attempt = 0; attempt < env.AUTH_RATE_LIMIT_MAX; attempt++) {
      expect((await login('nobody@vidaplus.com', password, ip)).statusCode).toBe(401);
    }

    const response = await login('nobody@vidaplus.com', password, ip);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: 'Too Many Requests', statusCode: 429 });
    expect((await login('nobody@vidaplus.com', password, nextIp())).statusCode).toBe(401);
  });
});

describe('authentication on protected routes', () => {
  it('responds 401 without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Missing or invalid access token', error: 'Unauthorized', statusCode: 401 });
  });

  it('responds 401 to a token signed with another secret', async () => {
    const user = await insertUser();
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, role: user.role, iat: Math.floor(Date.now() / 1000) })}`;
    const forged = `${unsigned}.${createHmac('sha256', 'x'.repeat(32)).update(unsigned).digest('base64url')}`;

    expect((await me(forged)).statusCode).toBe(401);
  });

  it('responds 401 to an expired token', async () => {
    const user = await insertUser();
    const token = signToken(app, user, new Date(Date.now() - 2 * env.JWT_EXPIRES_IN));

    expect((await me(token)).statusCode).toBe(401);
  });

  it('responds 401 when the user does not exist', async () => {
    const user = await insertUser();
    const token = signToken(app, user);
    await clearUsers();

    expect((await me(token)).statusCode).toBe(401);
  });

  it('responds 401 once the account is deactivated', async () => {
    const user = await insertUser();
    const token = signToken(app, user);
    expect((await me(token)).statusCode).toBe(200);

    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    expect((await me(token)).statusCode).toBe(401);
  });

  it('responds 401 to a token issued before the last password change', async () => {
    const user = await insertUser();
    const token = signToken(app, user, new Date(Date.now() - 60_000));
    expect((await me(token)).statusCode).toBe(200);

    await db.update(users).set({ passwordChangedAt: new Date() }).where(eq(users.id, user.id));

    expect((await me(token)).statusCode).toBe(401);
  });

  it('uses the role stored in the database rather than the one in the token', async () => {
    const user = await insertUser({ role: 'PATIENT' });
    const token = app.jwt.sign({ sub: user.id, role: 'ADMIN' });

    const response = await app.inject({ method: 'GET', url: '/audit-logs', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /auth/me', () => {
  it('returns the authenticated user without the password hash', async () => {
    const user = await insertUserWithPassword({ email: 'carla@vidaplus.com', role: 'ADMIN' });
    const { accessToken } = (await login(user.email)).json();

    const response = await me(accessToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: user.id,
      email: 'carla@vidaplus.com',
      role: 'ADMIN',
      active: true,
      lastLoginAt: expect.any(String),
      createdAt: user.createdAt.toISOString(),
    });
    expect(response.body).not.toContain('argon2');
  });
});

describe('POST /auth/logout', () => {
  it('responds 204 to an authenticated user', async () => {
    const token = signToken(app, await insertUser());

    const response = await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('responds 401 without a token', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/logout' })).statusCode).toBe(401);
  });
});

describe('POST /auth/password/forgot', () => {
  it('stores only the SHA-256 of the token and emails the reset link', async () => {
    const user = await insertUser();
    const before = Date.now();

    const response = await post('/auth/password/forgot', { email: user.email.toUpperCase() });

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('');
    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0].to).toBe(user.email);
    const link = new URL(/https?:\/\/\S+/.exec(emails.sent[0].text)![0]);
    expect(`${link.origin}${link.pathname}`).toBe(new URL('/reset-password', env.APP_URL).toString());
    const rawToken = link.searchParams.get('token')!;
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await findPasswordResetTokens();
    expect(row).toMatchObject({ userId: user.id, tokenHash: sha256(rawToken), usedAt: null });
    expect(JSON.stringify(row)).not.toContain(rawToken);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(env.RESET_TOKEN_TTL);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1);
  });

  it('responds 202 to an unknown email without issuing a token or sending email', async () => {
    const response = await post('/auth/password/forgot', { email: 'nobody@vidaplus.com' });

    expect(response.statusCode).toBe(202);
    expect(await findPasswordResetTokens()).toEqual([]);
    expect(emails.sent).toEqual([]);
  });

  it('does not issue a token to an inactive account', async () => {
    const user = await insertUser({ active: false });

    expect((await post('/auth/password/forgot', { email: user.email })).statusCode).toBe(202);
    expect(await findPasswordResetTokens()).toEqual([]);
  });

  it('invalidates the pending token when a new one is issued', async () => {
    const user = await insertUserWithPassword();
    const first = await requestReset(user);
    const second = await requestReset(user);

    const stale = await post('/auth/password/reset', { token: first, password: 'brand new password' });
    const fresh = await post('/auth/password/reset', { token: second, password: 'brand new password' });

    expect(stale.statusCode).toBe(422);
    expect(fresh.statusCode).toBe(204);
  });

  it('responds 202 even when sending the email fails', async () => {
    const failing = buildApp({ emailSender: { send: async () => Promise.reject(new Error('smtp down')) } });
    await failing.ready();
    const user = await insertUser();

    const response = await failing.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: user.email }, remoteAddress: nextIp() });
    await failing.close();

    expect(response.statusCode).toBe(202);
    expect(await findPasswordResetTokens()).toHaveLength(1);
  });

  it('responds 400 to a malformed email', async () => {
    expect((await post('/auth/password/forgot', { email: 'maria' })).statusCode).toBe(400);
  });
});

describe('POST /auth/password/reset', () => {
  it('changes the password so only the new one logs in', async () => {
    const user = await insertUserWithPassword();
    const token = await requestReset(user);

    const response = await post('/auth/password/reset', { token, password: 'brand new password' });

    expect(response.statusCode).toBe(204);
    expect((await login(user.email, password)).statusCode).toBe(401);
    expect((await login(user.email, 'brand new password')).statusCode).toBe(200);
    const [row] = await findUsers();
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(row.passwordChangedAt).not.toBeNull();
  });

  it('keeps a token issued right after the reset valid', async () => {
    const user = await insertUserWithPassword();
    await post('/auth/password/reset', { token: await requestReset(user), password: 'brand new password' });

    const { accessToken } = (await login(user.email, 'brand new password')).json();

    expect((await me(accessToken)).statusCode).toBe(200);
  });

  it('revokes access tokens issued before the reset', async () => {
    const user = await insertUserWithPassword();
    const oldToken = signToken(app, user, new Date(Date.now() - 60_000));
    expect((await me(oldToken)).statusCode).toBe(200);

    await post('/auth/password/reset', { token: await requestReset(user), password: 'brand new password' });

    expect((await me(oldToken)).statusCode).toBe(401);
  });

  it('rejects a token that was already used', async () => {
    const user = await insertUserWithPassword();
    const token = await requestReset(user);
    await post('/auth/password/reset', { token, password: 'brand new password' });

    const response = await post('/auth/password/reset', { token, password: 'another new password' });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Password reset token has already been used');
    expect((await login(user.email, 'brand new password')).statusCode).toBe(200);
  });

  it('invalidates every other pending token of the user', async () => {
    const user = await insertUserWithPassword();
    const token = await requestReset(user);
    const other = PasswordResetToken.issue(user.id, sha256('other-token'), new Date(), env.RESET_TOKEN_TTL);
    await resetTokenRepository.insert(other);

    await post('/auth/password/reset', { token, password: 'brand new password' });

    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.id, other.id));
    expect(row.usedAt).not.toBeNull();
  });

  it('rejects an expired token', async () => {
    const user = await insertUserWithPassword();
    const token = await requestReset(user);
    await db.update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) });

    const response = await post('/auth/password/reset', { token, password: 'brand new password' });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Password reset token has expired');
    expect((await login(user.email, password)).statusCode).toBe(200);
  });

  it('rejects an unknown token', async () => {
    const response = await post('/auth/password/reset', { token: 'A'.repeat(43), password: 'brand new password' });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toBe('Invalid password reset token');
  });

  it('rejects a reset for an account deactivated after the token was issued', async () => {
    const user = await insertUserWithPassword();
    const token = await requestReset(user);
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    const response = await post('/auth/password/reset', { token, password: 'brand new password' });

    expect(response.statusCode).toBe(422);
    const [row] = await findPasswordResetTokens();
    expect(row.usedAt).toBeNull();
  });

  it.each([
    ['the token is malformed', { token: 'short', password: 'brand new password' }],
    ['the password is shorter than 8 characters', { token: 'A'.repeat(43), password: '1234567' }],
    ['the password is longer than 128 characters', { token: 'A'.repeat(43), password: 'a'.repeat(129) }],
  ])('responds 400 when %s', async (_, payload) => {
    expect((await post('/auth/password/reset', payload)).statusCode).toBe(400);
  });
});

describe('OpenAPI spec', () => {
  it('documents the auth routes and requires bearer auth only where needed', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(spec.paths['/auth/login'].post.tags).toEqual(['auth']);
    expect(spec.paths['/auth/login'].post.security).toBeUndefined();
    expect(spec.paths['/auth/password/forgot'].post.security).toBeUndefined();
    expect(spec.paths['/auth/password/reset'].post.security).toBeUndefined();
    expect(spec.paths['/auth/me'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths['/auth/logout'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.components.schemas.User.properties).not.toHaveProperty('passwordHash');
  });
});
