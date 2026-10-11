import { randomInt } from 'node:crypto';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function checkDigit(base: string): number {
  let weight = 2;
  let sum = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += (base.charCodeAt(index) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function generateCnpj(): string {
  const root = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
  const base = `${root}0001`;
  const withFirst = `${base}${checkDigit(base)}`;
  return `${withFirst}${checkDigit(withFirst)}`;
}

export function maskCnpj(cnpj: string): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}
