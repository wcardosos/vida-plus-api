import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';

export type PasswordResetTokenProps = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

const tokenHashPattern = /^[0-9a-f]{64}$/;

export class PasswordResetToken {
  private constructor(private readonly props: PasswordResetTokenProps) {}

  static issue(userId: string, tokenHash: string, now: Date, ttlMs: number): PasswordResetToken {
    if (!userId) {
      throw new DomainError('userId is required');
    }
    if (!tokenHashPattern.test(tokenHash)) {
      throw new DomainError('tokenHash must be a hex-encoded SHA-256 digest');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new DomainError('ttl must be a positive duration');
    }

    return new PasswordResetToken({
      id: randomUUID(),
      userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + ttlMs),
      usedAt: null,
      createdAt: now,
    });
  }

  static restore(props: PasswordResetTokenProps): PasswordResetToken {
    return new PasswordResetToken({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get userId() {
    return this.props.userId;
  }

  get tokenHash() {
    return this.props.tokenHash;
  }

  get expiresAt() {
    return this.props.expiresAt;
  }

  get usedAt() {
    return this.props.usedAt;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  isValid(now: Date): boolean {
    return this.props.usedAt === null && now.getTime() < this.props.expiresAt.getTime();
  }

  markUsed(at: Date): void {
    if (this.props.usedAt !== null) {
      throw new DomainError('Password reset token has already been used');
    }
    if (at.getTime() >= this.props.expiresAt.getTime()) {
      throw new DomainError('Password reset token has expired');
    }
    this.props.usedAt = at;
  }
}
