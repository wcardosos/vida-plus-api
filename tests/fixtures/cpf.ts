import { randomInt } from 'node:crypto';

function checkDigit(digits: string): number {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    sum += Number(digits[index]) * (digits.length + 1 - index);
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function generateCpf(): string {
  let base: string;
  do {
    base = Array.from({ length: 9 }, () => randomInt(10)).join('');
  } while (/^(\d)\1{8}$/.test(base));
  const withFirst = `${base}${checkDigit(base)}`;
  return `${withFirst}${checkDigit(withFirst)}`;
}

export function maskCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
