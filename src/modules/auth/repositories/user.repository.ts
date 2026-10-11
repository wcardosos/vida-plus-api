import { eq } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../db/client';
import { User } from '../entities/user.entity';
import { users } from '../schema';

type UserRow = typeof users.$inferSelect;

function toEntity(row: UserRow): User {
  return User.restore({
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    active: row.active,
    lastLoginAt: row.lastLoginAt,
    passwordChangedAt: row.passwordChangedAt,
    createdAt: row.createdAt,
  });
}

export type UserRepository = ReturnType<typeof createUserRepository>;

export function createUserRepository(db: Database) {
  return {
    async insert(user: User, executor: DbExecutor = db): Promise<void> {
      await executor.insert(users).values({
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        active: user.active,
        lastLoginAt: user.lastLoginAt,
        passwordChangedAt: user.passwordChangedAt,
        createdAt: user.createdAt,
        updatedAt: user.createdAt,
      });
    },

    async update(user: User, executor: DbExecutor = db): Promise<void> {
      await executor
        .update(users)
        .set({
          email: user.email,
          passwordHash: user.passwordHash,
          active: user.active,
          lastLoginAt: user.lastLoginAt,
          passwordChangedAt: user.passwordChangedAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    },

    async findById(id: string, executor: DbExecutor = db): Promise<User | null> {
      const [row] = await executor.select().from(users).where(eq(users.id, id));
      return row ? toEntity(row) : null;
    },

    async findByIdForUpdate(id: string, executor: DbExecutor): Promise<User | null> {
      const [row] = await executor.select().from(users).where(eq(users.id, id)).for('update');
      return row ? toEntity(row) : null;
    },

    async findByEmail(email: string, executor: DbExecutor = db): Promise<User | null> {
      const [row] = await executor.select().from(users).where(eq(users.email, email));
      return row ? toEntity(row) : null;
    },
  };
}
