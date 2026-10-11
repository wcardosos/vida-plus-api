import { and, eq, isNull } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../db/client';
import { PasswordResetToken } from './password-reset-token.entity';
import { passwordResetTokens } from './schema';

type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;

function toEntity(row: PasswordResetTokenRow): PasswordResetToken {
  return PasswordResetToken.restore({
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  });
}

export type PasswordResetTokenRepository = ReturnType<typeof createPasswordResetTokenRepository>;

export function createPasswordResetTokenRepository(db: Database) {
  return {
    async insert(token: PasswordResetToken, executor: DbExecutor = db): Promise<void> {
      await executor.insert(passwordResetTokens).values({
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        usedAt: token.usedAt,
        createdAt: token.createdAt,
      });
    },

    async update(token: PasswordResetToken, executor: DbExecutor = db): Promise<void> {
      await executor.update(passwordResetTokens).set({ usedAt: token.usedAt }).where(eq(passwordResetTokens.id, token.id));
    },

    async findByHashForUpdate(tokenHash: string, executor: DbExecutor): Promise<PasswordResetToken | null> {
      const [row] = await executor.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash)).for('update');
      return row ? toEntity(row) : null;
    },

    async invalidatePendingForUser(userId: string, at: Date, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(passwordResetTokens)
        .set({ usedAt: at })
        .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    },
  };
}
