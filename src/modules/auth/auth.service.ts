import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Database, Transaction } from '../../db/client';
import type { EmailSender } from '../../shared/email-sender';
import { ConflictError, DomainError, NotFoundError, UnauthorizedError } from '../../shared/errors';
import { loggableError } from '../../shared/logger';
import type { Role } from '../../shared/roles';
import { hashPassword, verifyPassword } from './password';
import { PasswordResetToken } from './password-reset-token.entity';
import type { PasswordResetTokenRepository } from './password-reset-token.repository';
import { Email, User } from './user.entity';
import type { UserRepository } from './user.repository';

export type CreateUserInput = {
  email: string;
  password: string;
  role: Role;
};

export type Credentials = {
  email: string;
  password: string;
};

export type AuthenticatedUser = {
  id: string;
  role: Role;
};

export type AuthServiceConfig = {
  appUrl: string;
  resetTokenTtlMs: number;
};

export type AuthService = ReturnType<typeof createAuthService>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createAuthService(deps: {
  db: Database;
  users: UserRepository;
  resetTokens: PasswordResetTokenRepository;
  emailSender: EmailSender;
  logger: FastifyBaseLogger;
  config: AuthServiceConfig;
}) {
  const { db, users, resetTokens, emailSender, logger, config } = deps;

  let dummyHash: Promise<string> | undefined;

  async function createUser(input: CreateUserInput, tx?: Transaction): Promise<User> {
    const email = Email.create(input.email).value;
    if (await users.findByEmail(email, tx)) {
      throw new ConflictError('Email is already in use');
    }
    const user = User.create({ email, passwordHash: await hashPassword(input.password), role: input.role });
    await users.insert(user, tx);
    return user;
  }

  async function login(credentials: Credentials): Promise<User> {
    const user = await users.findByEmail(Email.create(credentials.email).value);
    dummyHash ??= hashPassword(randomUUID());
    const passwordMatches = await verifyPassword(user?.passwordHash ?? (await dummyHash), credentials.password);
    if (!user || !passwordMatches) {
      throw new UnauthorizedError('Invalid email or password');
    }

    user.recordLogin(new Date());
    await users.update(user);
    return user;
  }

  async function findAuthenticatedUser(userId: string, tokenIssuedAt: Date): Promise<AuthenticatedUser | null> {
    const user = await users.findById(userId);
    if (!user || !user.canAuthenticate() || user.wasTokenIssuedBeforePasswordChange(tokenIssuedAt)) {
      return null;
    }
    return { id: user.id, role: user.role };
  }

  async function getUser(userId: string): Promise<User> {
    const user = await users.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  async function requestPasswordReset(rawEmail: string): Promise<void> {
    const user = await users.findByEmail(Email.create(rawEmail).value);
    if (!user || !user.canAuthenticate()) {
      return;
    }

    const now = new Date();
    const rawToken = randomBytes(32).toString('base64url');
    const token = PasswordResetToken.issue(user.id, sha256(rawToken), now, config.resetTokenTtlMs);
    await db.transaction(async (tx) => {
      await resetTokens.invalidatePendingForUser(user.id, now, tx);
      await resetTokens.insert(token, tx);
    });

    const link = new URL('/reset-password', config.appUrl);
    link.searchParams.set('token', rawToken);
    const validMinutes = Math.round(config.resetTokenTtlMs / 60_000);

    emailSender
      .send({
        to: user.email,
        subject: 'Vida Plus password reset',
        text: `A password reset was requested for your Vida Plus account. Open ${link.toString()} within ${validMinutes} minutes to choose a new password. If you did not request it, ignore this email.`,
      })
      .catch((error: unknown) => {
        logger.error({ err: loggableError(error), userId: user.id }, 'failed to send password reset email');
      });
  }

  async function resetPassword(input: { token: string; password: string }): Promise<void> {
    const newPasswordHash = await hashPassword(input.password);
    const now = new Date();

    await db.transaction(async (tx) => {
      const token = await resetTokens.findByHashForUpdate(sha256(input.token), tx);
      if (!token) {
        throw new DomainError('Invalid password reset token');
      }
      token.markUsed(now);

      const user = await users.findByIdForUpdate(token.userId, tx);
      if (!user) {
        throw new DomainError('Invalid password reset token');
      }
      user.changePassword(newPasswordHash, now);

      await users.update(user, tx);
      await resetTokens.update(token, tx);
      await resetTokens.invalidatePendingForUser(user.id, now, tx);
    });
  }

  async function ensureAdmin(input: Credentials): Promise<{ user: User; created: boolean }> {
    const existing = await users.findByEmail(Email.create(input.email).value);
    if (existing) {
      return { user: existing, created: false };
    }
    return { user: await createUser({ ...input, role: 'ADMIN' }), created: true };
  }

  return { createUser, login, findAuthenticatedUser, getUser, requestPasswordReset, resetPassword, ensureAdmin };
}
