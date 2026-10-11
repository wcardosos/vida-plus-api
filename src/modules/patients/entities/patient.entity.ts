import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { Address, type AddressInput } from '../../../shared/value-objects/address';

const cpfInputPattern = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/;

function cpfCheckDigit(digits: string, length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += Number(digits[index]) * (length + 1 - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export class Cpf {
  private constructor(readonly value: string) {}

  static create(raw: string): Cpf {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!cpfInputPattern.test(trimmed)) {
      throw new DomainError('cpf must have 11 digits');
    }

    const value = trimmed.replace(/\D/g, '');
    if (/^(\d)\1{10}$/.test(value)) {
      throw new DomainError('cpf must not repeat a single digit');
    }
    if (value.slice(9) !== `${cpfCheckDigit(value, 9)}${cpfCheckDigit(value, 10)}`) {
      throw new DomainError('cpf has invalid check digits');
    }
    return new Cpf(value);
  }

  static restore(value: string): Cpf {
    return new Cpf(value);
  }

  formatted(): string {
    const v = this.value;
    return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  }

  equals(other: Cpf): boolean {
    return this.value === other.value;
  }
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const brasiliaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

function validBirthDate(raw: string, now: Date): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!datePattern.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainError('birthDate must be a valid date in YYYY-MM-DD format');
  }
  if (value > brasiliaDate.format(now)) {
    throw new DomainError('birthDate must not be in the future');
  }
  return value;
}

function validName(raw: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) {
    throw new DomainError('name is required');
  }
  if (name.length > Patient.nameMaxLength) {
    throw new DomainError(`name must have at most ${Patient.nameMaxLength} characters`);
  }
  return name;
}

function validPhone(raw: string): string {
  const phone = typeof raw === 'string' ? raw.replace(/[\s().-]/g, '') : '';
  if (!/^\d{10,11}$/.test(phone)) {
    throw new DomainError('phone must have 10 or 11 digits including the area code');
  }
  return phone;
}

export type PatientProps = {
  id: string;
  userId: string;
  name: string;
  cpf: Cpf;
  birthDate: string;
  phone: string;
  address: Address;
  termsVersion: string;
  termsAcceptedAt: Date;
  createdAt: Date;
};

export type CreatePatientProps = {
  userId: string;
  name: string;
  cpf: string;
  birthDate: string;
  phone: string;
  address: AddressInput;
  acceptTerms: boolean;
  termsVersion: string;
};

export type ContactInfoChanges = {
  name?: string;
  phone?: string;
  address?: AddressInput;
};

export type IdentityCorrection = {
  cpf?: string;
  birthDate?: string;
};

export class Patient {
  static readonly nameMaxLength = 150;
  static readonly termsVersionMaxLength = 20;

  private constructor(private readonly props: PatientProps) {}

  static create(props: CreatePatientProps, now: Date = new Date()): Patient {
    if (!props.userId) {
      throw new DomainError('userId is required');
    }
    if (props.acceptTerms !== true) {
      throw new DomainError('The terms of use must be accepted');
    }
    const termsVersion = typeof props.termsVersion === 'string' ? props.termsVersion.trim() : '';
    if (!termsVersion || termsVersion.length > Patient.termsVersionMaxLength) {
      throw new DomainError(`termsVersion must have between 1 and ${Patient.termsVersionMaxLength} characters`);
    }

    return new Patient({
      id: randomUUID(),
      userId: props.userId,
      name: validName(props.name),
      cpf: Cpf.create(props.cpf),
      birthDate: validBirthDate(props.birthDate, now),
      phone: validPhone(props.phone),
      address: Address.create(props.address),
      termsVersion,
      termsAcceptedAt: now,
      createdAt: now,
    });
  }

  static restore(props: PatientProps): Patient {
    return new Patient({ ...props });
  }

  get id() {
    return this.props.id;
  }

  get userId() {
    return this.props.userId;
  }

  get name() {
    return this.props.name;
  }

  get cpf() {
    return this.props.cpf;
  }

  get birthDate() {
    return this.props.birthDate;
  }

  get phone() {
    return this.props.phone;
  }

  get address() {
    return this.props.address;
  }

  get termsVersion() {
    return this.props.termsVersion;
  }

  get termsAcceptedAt() {
    return this.props.termsAcceptedAt;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  updateContactInfo(changes: ContactInfoChanges): void {
    const name = changes.name !== undefined ? validName(changes.name) : this.props.name;
    const phone = changes.phone !== undefined ? validPhone(changes.phone) : this.props.phone;
    const address = changes.address !== undefined ? Address.create(changes.address) : this.props.address;
    this.props.name = name;
    this.props.phone = phone;
    this.props.address = address;
  }

  correctIdentity(correction: IdentityCorrection, now: Date = new Date()): void {
    const cpf = correction.cpf !== undefined ? Cpf.create(correction.cpf) : this.props.cpf;
    const birthDate = correction.birthDate !== undefined ? validBirthDate(correction.birthDate, now) : this.props.birthDate;
    this.props.cpf = cpf;
    this.props.birthDate = birthDate;
  }
}
