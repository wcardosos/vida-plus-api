import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Database, Transaction } from '../../../db/client';
import type { EmailSender } from '../../../shared/email-sender';
import { ConflictError, DomainError, NotFoundError, UnauthorizedError } from '../../../shared/errors';
import { loggableError } from '../../../shared/logger';
import type { Role } from '../../../shared/roles';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { Email, User } from '../entities/user.entity';
import type { PasswordResetTokenRepository } from '../repositories/password-reset-token.repository';
import type { UserRepository } from '../repositories/user.repository';
import { hashPassword, verifyPassword } from './password';

export type CreateUserInput = {
  email: string;
  password?: string;
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
  setupTokenTtlMs: number;
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
    const password = input.password ?? randomBytes(32).toString('base64url');
    const user = User.create({ email, passwordHash: await hashPassword(password), role: input.role });
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

  async function getUser(userId: string, tx?: Transaction): Promise<User> {
    const user = await users.findById(userId, tx);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  async function loadForUpdate(userId: string, tx: Transaction): Promise<User> {
    const user = await users.findByIdForUpdate(userId, tx);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  function inTransaction<T>(tx: Transaction | undefined, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return tx ? work(tx) : db.transaction(work);
  }

  async function updateEmail(userId: string, rawEmail: string, tx?: Transaction): Promise<User> {
    return inTransaction(tx, async (tx) => {
      const user = await loadForUpdate(userId, tx);
      const email = Email.create(rawEmail).value;
      if (email === user.email) {
        return user;
      }
      if (await users.findByEmail(email, tx)) {
        throw new ConflictError('Email is already in use');
      }

      user.changeEmail(email);
      await users.update(user, tx);
      await resetTokens.invalidatePendingForUser(user.id, new Date(), tx);
      return user;
    });
  }

  async function deactivate(userId: string, tx?: Transaction): Promise<boolean> {
    return inTransaction(tx, async (tx) => {
      const user = await loadForUpdate(userId, tx);
      if (!user.active) {
        return false;
      }
      user.deactivate();
      await users.update(user, tx);
      return true;
    });
  }

  async function activate(userId: string, tx?: Transaction): Promise<boolean> {
    return inTransaction(tx, async (tx) => {
      const user = await loadForUpdate(userId, tx);
      if (user.active) {
        return false;
      }
      user.activate();
      await users.update(user, tx);
      return true;
    });
  }

  async function issueToken(user: User, ttlMs: number): Promise<string> {
    const now = new Date();
    const rawToken = randomBytes(32).toString('base64url');
    const token = PasswordResetToken.issue(user.id, sha256(rawToken), now, ttlMs);
    await db.transaction(async (tx) => {
      await resetTokens.invalidatePendingForUser(user.id, now, tx);
      await resetTokens.insert(token, tx);
    });
    return rawToken;
  }

  function passwordLink(rawToken: string): string {
    const link = new URL('/reset-password', config.appUrl);
    link.searchParams.set('token', rawToken);
    return link.toString();
  }

  function sendEmail(user: User, subject: string, text: string, failureMessage: string): void {
    emailSender.send({ to: user.email, subject, text }).catch((error: unknown) => {
      logger.error({ err: loggableError(error), userId: user.id }, failureMessage);
    });
  }

  async function requestPasswordReset(rawEmail: string): Promise<void> {
    const user = await users.findByEmail(Email.create(rawEmail).value);
    if (!user || !user.canAuthenticate()) {
      return;
    }

    const rawToken = await issueToken(user, config.resetTokenTtlMs);
    const validMinutes = Math.round(config.resetTokenTtlMs / 60_000);
    sendEmail(
      user,
      'Vida Plus password reset',
      `A password reset was requested for your Vida Plus account. Open ${passwordLink(rawToken)} within ${validMinutes} minutes to choose a new password. If you did not request it, ignore this email.`,
      'failed to send password reset email',
    );
  }

  async function issuePasswordSetup(userId: string): Promise<void> {
    try {
      const user = await getUser(userId);
      const rawToken = await issueToken(user, config.setupTokenTtlMs);
      const validHours = Math.round(config.setupTokenTtlMs / 3_600_000);
      sendEmail(
        user,
        'Welcome to Vida Plus: set your password',
        `An account was created for you at Vida Plus. Open ${passwordLink(rawToken)} within ${validHours} hours to choose your password. After that, use the forgot password option to receive a new link.`,
        'failed to send password setup email',
      );
    } catch (error) {
      logger.error({ err: loggableError(error), userId }, 'failed to issue password setup token');
    }
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

  return {
    createUser,
    login,
    findAuthenticatedUser,
    getUser,
    updateEmail,
    deactivate,
    activate,
    requestPasswordReset,
    issuePasswordSetup,
    resetPassword,
    ensureAdmin,
  };
}
