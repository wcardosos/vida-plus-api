import { randomUUID } from 'node:crypto';
import { DomainError } from '../../../shared/errors';
import { isBrazilianState, type BrazilianState } from '../../../shared/value-objects/address';

export const professionalCategories = ['PHYSICIAN', 'NURSE', 'TECHNICIAN'] as const;

export type ProfessionalCategory = (typeof professionalCategories)[number];

export const councils = ['CRM', 'COREN'] as const;

export type Council = (typeof councils)[number];

const councilByCategory: Record<ProfessionalCategory, Council> = {
  PHYSICIAN: 'CRM',
  NURSE: 'COREN',
  TECHNICIAN: 'COREN',
};

const registrationNumberPattern = /^[0-9A-Z-]+$/;

function normalized(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function isCategory(value: unknown): value is ProfessionalCategory {
  return (professionalCategories as readonly unknown[]).includes(value);
}

function isCouncil(value: string): value is Council {
  return (councils as readonly string[]).includes(value);
}

export type CouncilRegistrationInput = {
  council: string;
  number: string;
  state: string;
};

export type CouncilRegistrationProps = {
  council: Council;
  number: string;
  state: BrazilianState;
};

export class CouncilRegistration {
  static readonly numberMaxLength = 20;

  private constructor(private readonly props: CouncilRegistrationProps) {}

  static create(input: CouncilRegistrationInput, category: ProfessionalCategory): CouncilRegistration {
    const council = normalized(input.council);
    if (!council) {
      throw new DomainError('registration.council is required');
    }
    if (!isCouncil(council)) {
      throw new DomainError(`registration.council must be one of ${councils.join(', ')}`);
    }

    const number = normalized(input.number);
    if (!number) {
      throw new DomainError('registration.number is required');
    }
    if (number.length > CouncilRegistration.numberMaxLength || !registrationNumberPattern.test(number)) {
      throw new DomainError(`registration.number must have up to ${CouncilRegistration.numberMaxLength} letters, digits or hyphens`);
    }

    const state = normalized(input.state);
    if (!state) {
      throw new DomainError('registration.state is required');
    }
    if (!isBrazilianState(state)) {
      throw new DomainError('registration.state must be a valid Brazilian state abbreviation');
    }

    const expected = councilByCategory[category];
    if (council !== expected) {
      throw new DomainError(`registration.council must be ${expected} for category ${category}`);
    }
    return new CouncilRegistration({ council, number, state });
  }

  static restore(props: CouncilRegistrationProps): CouncilRegistration {
    return new CouncilRegistration({ ...props });
  }

  get council() {
    return this.props.council;
  }

  get number() {
    return this.props.number;
  }

  get state() {
    return this.props.state;
  }

  formatted(): string {
    return `${this.props.council} ${this.props.number}/${this.props.state}`;
  }

  equals(other: CouncilRegistration): boolean {
    return this.props.council === other.council && this.props.number === other.number && this.props.state === other.state;
  }

  toProps(): CouncilRegistrationProps {
    return { ...this.props };
  }
}

export type ProfessionalProps = {
  id: string;
  userId: string;
  name: string;
  category: ProfessionalCategory;
  registration: CouncilRegistration;
  specialty: string | null;
  unitIds: string[];
  createdAt: Date;
};

export type CreateProfessionalProps = {
  userId: string;
  name: string;
  category: ProfessionalCategory;
  registration: CouncilRegistrationInput;
  specialty?: string | null;
  unitIds: readonly string[];
};

export type UpdateProfessionalProps = {
  name?: string;
  category?: ProfessionalCategory;
  registration?: CouncilRegistrationInput;
  specialty?: string | null;
};

function validCategory(raw: ProfessionalCategory): ProfessionalCategory {
  if (!isCategory(raw)) {
    throw new DomainError(`category must be one of ${professionalCategories.join(', ')}`);
  }
  return raw;
}

function validName(raw: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) {
    throw new DomainError('name is required');
  }
  if (name.length > Professional.nameMaxLength) {
    throw new DomainError(`name must have at most ${Professional.nameMaxLength} characters`);
  }
  return name;
}

function validSpecialty(raw: string | null | undefined): string | null {
  const specialty = typeof raw === 'string' ? raw.trim() : '';
  if (specialty.length > Professional.specialtyMaxLength) {
    throw new DomainError(`specialty must have at most ${Professional.specialtyMaxLength} characters`);
  }
  return specialty || null;
}

export class Professional {
  static readonly nameMaxLength = 150;
  static readonly specialtyMaxLength = 100;

  private constructor(private readonly props: ProfessionalProps) {}

  static create(props: CreateProfessionalProps, now: Date = new Date()): Professional {
    if (!props.userId) {
      throw new DomainError('userId is required');
    }
    const category = validCategory(props.category);
    const unitIds = [...new Set(props.unitIds ?? [])];
    if (unitIds.length === 0 || unitIds.some((unitId) => !unitId)) {
      throw new DomainError('Professional must be linked to at least one unit');
    }

    return new Professional({
      id: randomUUID(),
      userId: props.userId,
      name: validName(props.name),
      category,
      registration: CouncilRegistration.create(props.registration, category),
      specialty: validSpecialty(props.specialty),
      unitIds,
      createdAt: now,
    });
  }

  static restore(props: ProfessionalProps): Professional {
    return new Professional({ ...props, unitIds: [...props.unitIds] });
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

  get category() {
    return this.props.category;
  }

  get registration() {
    return this.props.registration;
  }

  get specialty() {
    return this.props.specialty;
  }

  get unitIds(): string[] {
    return [...this.props.unitIds];
  }

  get createdAt() {
    return this.props.createdAt;
  }

  update(changes: UpdateProfessionalProps): void {
    const name = changes.name !== undefined ? validName(changes.name) : this.props.name;
    const category = changes.category !== undefined ? validCategory(changes.category) : this.props.category;
    const registrationInput = changes.registration ?? (changes.category !== undefined ? this.props.registration.toProps() : undefined);
    const registration = registrationInput !== undefined ? CouncilRegistration.create(registrationInput, category) : this.props.registration;
    const specialty = changes.specialty !== undefined ? validSpecialty(changes.specialty) : this.props.specialty;

    this.props.name = name;
    this.props.category = category;
    this.props.registration = registration;
    this.props.specialty = specialty;
  }

  isLinkedTo(unitId: string): boolean {
    return this.props.unitIds.includes(unitId);
  }

  linkUnit(unitId: string): void {
    if (!unitId) {
      throw new DomainError('unitId is required');
    }
    if (this.isLinkedTo(unitId)) {
      throw new DomainError('Professional is already linked to this unit');
    }
    this.props.unitIds.push(unitId);
  }

  unlinkUnit(unitId: string): void {
    if (!this.isLinkedTo(unitId)) {
      throw new DomainError('Professional is not linked to this unit');
    }
    if (this.props.unitIds.length === 1) {
      throw new DomainError('Professional must be linked to at least one unit');
    }
    this.props.unitIds = this.props.unitIds.filter((linked) => linked !== unitId);
  }

  canPrescribe(): boolean {
    return this.props.category === 'PHYSICIAN';
  }
}
