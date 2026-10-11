import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { roles, type Role } from '../../../shared/roles';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  static readonly maxLength = 254;

  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!value) {
      throw new DomainError('email is required');
    }
    if (value.length > Email.maxLength || !emailPattern.test(value)) {
      throw new DomainError('email must be a valid email address');
    }
    return new Email(value);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}

export type UserProps = {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
};

export type CreateUserProps = {
  email: string;
  passwordHash: string;
  role: Role;
};

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(props: CreateUserProps, now: Date = new Date()): User {
    if (!props.passwordHash) {
      throw new DomainError('passwordHash is required');
    }
    if (!roles.includes(props.role)) {
      throw new DomainError(`role must be one of ${roles.join(', ')}`);
    }

    return new User({
      id: randomUUID(),
      email: Email.create(props.email).value,
      passwordHash: props.passwordHash,
      role: props.role,
      active: true,
      lastLoginAt: null,
      passwordChangedAt: null,
      createdAt: now,
    });
  }

  static restore(props: UserProps): User {
    return new User({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get email() {
    return this.props.email;
  }

  get passwordHash() {
    return this.props.passwordHash;
  }

  get role() {
    return this.props.role;
  }

  get active() {
    return this.props.active;
  }

  get lastLoginAt() {
    return this.props.lastLoginAt;
  }

  get passwordChangedAt() {
    return this.props.passwordChangedAt;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  canAuthenticate(): boolean {
    return this.props.active;
  }

  recordLogin(at: Date): void {
    this.ensureActive();
    this.props.lastLoginAt = at;
  }

  changePassword(newPasswordHash: string, at: Date): void {
    this.ensureActive();
    if (!newPasswordHash) {
      throw new DomainError('passwordHash is required');
    }
    this.props.passwordHash = newPasswordHash;
    this.props.passwordChangedAt = at;
  }

  deactivate(): void {
    this.props.active = false;
  }

  wasTokenIssuedBeforePasswordChange(issuedAt: Date): boolean {
    if (!this.props.passwordChangedAt) {
      return false;
    }
    // JWT iat has whole-second precision, so the change time is truncated to avoid rejecting a token issued right after it.
    const changedAtSecond = Math.floor(this.props.passwordChangedAt.getTime() / 1000) * 1000;
    return issuedAt.getTime() < changedAtSecond;
  }

  private ensureActive(): void {
    if (!this.props.active) {
      throw new DomainError('User account is inactive');
    }
  }
}
