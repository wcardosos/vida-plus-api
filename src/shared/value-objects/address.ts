import { DomainError } from '../errors';

export const brazilianStates = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

export type BrazilianState = (typeof brazilianStates)[number];

export type AddressProps = {
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: BrazilianState;
  zipCode: string;
};

export type AddressInput = {
  street: string;
  number: string;
  complement?: string | null;
  district: string;
  city: string;
  state: string;
  zipCode: string;
};

const zipCodePattern = /^(\d{5})-?(\d{3})$/;

function isBrazilianState(value: string): value is BrazilianState {
  return (brazilianStates as readonly string[]).includes(value);
}

function requiredText(raw: unknown, field: string, maxLength: number): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw new DomainError(`address.${field} is required`);
  }
  if (value.length > maxLength) {
    throw new DomainError(`address.${field} must have at most ${maxLength} characters`);
  }
  return value;
}

export class Address {
  static readonly maxLength = { street: 150, number: 20, complement: 100, district: 100, city: 100 } as const;

  private constructor(private readonly props: AddressProps) {}

  static create(input: AddressInput): Address {
    const complement = typeof input.complement === 'string' ? input.complement.trim() : '';
    if (complement.length > Address.maxLength.complement) {
      throw new DomainError(`address.complement must have at most ${Address.maxLength.complement} characters`);
    }

    const state = typeof input.state === 'string' ? input.state.trim().toUpperCase() : '';
    if (!isBrazilianState(state)) {
      throw new DomainError('address.state must be a valid Brazilian state abbreviation');
    }

    const zipMatch = typeof input.zipCode === 'string' ? zipCodePattern.exec(input.zipCode.trim()) : null;
    if (!zipMatch) {
      throw new DomainError('address.zipCode must have 8 digits');
    }

    return new Address({
      street: requiredText(input.street, 'street', Address.maxLength.street),
      number: requiredText(input.number, 'number', Address.maxLength.number),
      complement: complement || null,
      district: requiredText(input.district, 'district', Address.maxLength.district),
      city: requiredText(input.city, 'city', Address.maxLength.city),
      state,
      zipCode: `${zipMatch[1]}${zipMatch[2]}`,
    });
  }

  static restore(props: AddressProps): Address {
    return new Address({ ...props });
  }

  get street() {
    return this.props.street;
  }

  get number() {
    return this.props.number;
  }

  get complement() {
    return this.props.complement;
  }

  get district() {
    return this.props.district;
  }

  get city() {
    return this.props.city;
  }

  get state() {
    return this.props.state;
  }

  get zipCode() {
    return this.props.zipCode;
  }

  toProps(): AddressProps {
    return { ...this.props };
  }
}
