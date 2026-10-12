import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { Address, type AddressInput } from '../../../shared/value-objects/address';

const cnpjPattern = /^[0-9A-Z]{12}[0-9]{2}$/;
const firstCheckDigitWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const secondCheckDigitWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function checkDigit(base: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + (base.charCodeAt(index) - 48) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export class Cnpj {
  private constructor(readonly value: string) {}

  static create(raw: string): Cnpj {
    const value = typeof raw === 'string' ? raw.trim().replace(/[./-]/g, '').toUpperCase() : '';
    if (!cnpjPattern.test(value)) {
      throw new DomainError('cnpj must have 12 alphanumeric characters followed by 2 check digits');
    }
    if (/^(.)\1{13}$/.test(value)) {
      throw new DomainError('cnpj must not repeat a single character');
    }

    const first = checkDigit(value, firstCheckDigitWeights);
    const second = checkDigit(value, secondCheckDigitWeights);
    if (value.slice(12) !== `${first}${second}`) {
      throw new DomainError('cnpj has invalid check digits');
    }
    return new Cnpj(value);
  }

  static restore(value: string): Cnpj {
    return new Cnpj(value);
  }

  formatted(): string {
    const v = this.value;
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  }

  equals(other: Cnpj): boolean {
    return this.value === other.value;
  }
}

export const unitTypes = ['HOSPITAL', 'CLINIC', 'LABORATORY', 'HOME_CARE'] as const;

export type UnitType = (typeof unitTypes)[number];

export type UnitProps = {
  id: string;
  name: string;
  type: UnitType;
  cnpj: Cnpj;
  address: Address;
  active: boolean;
  createdAt: Date;
};

export type CreateUnitProps = {
  name: string;
  type: UnitType;
  cnpj: string;
  address: AddressInput;
};

export type UpdateUnitProps = {
  name?: string;
  address?: AddressInput;
};

export class Unit {
  static readonly nameMinLength = 3;
  static readonly nameMaxLength = 120;

  private constructor(private readonly props: UnitProps) {}

  static create(props: CreateUnitProps, now: Date = new Date()): Unit {
    if (!unitTypes.includes(props.type)) {
      throw new DomainError(`type must be one of ${unitTypes.join(', ')}`);
    }

    return new Unit({
      id: randomUUID(),
      name: Unit.validName(props.name),
      type: props.type,
      cnpj: Cnpj.create(props.cnpj),
      address: Address.create(props.address),
      active: true,
      createdAt: now,
    });
  }

  static restore(props: UnitProps): Unit {
    return new Unit({ ...props });
  }

  private static validName(raw: string): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (name.length < Unit.nameMinLength || name.length > Unit.nameMaxLength) {
      throw new DomainError(`name must have between ${Unit.nameMinLength} and ${Unit.nameMaxLength} characters`);
    }
    return name;
  }

  get id() {
    return this.props.id;
  }

  get name() {
    return this.props.name;
  }

  get type() {
    return this.props.type;
  }

  get cnpj() {
    return this.props.cnpj;
  }

  get address() {
    return this.props.address;
  }

  get active() {
    return this.props.active;
  }

  get createdAt() {
    return this.props.createdAt;
  }

  update(changes: UpdateUnitProps): void {
    if (!this.props.active) {
      throw new DomainError('Unit is inactive');
    }

    const name = changes.name !== undefined ? Unit.validName(changes.name) : this.props.name;
    const address = changes.address !== undefined ? Address.create(changes.address) : this.props.address;
    this.props.name = name;
    this.props.address = address;
  }

  deactivate(): void {
    this.props.active = false;
  }

  isLaboratory(): boolean {
    return this.props.type === 'LABORATORY';
  }

  isHospital(): boolean {
    return this.props.type === 'HOSPITAL';
  }

  isActive(): boolean {
    return this.props.active;
  }
}
