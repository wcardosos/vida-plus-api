import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFieldCipher } from './crypto';

const key = randomBytes(32);
const cipher = createFieldCipher(key);

function tamper(stored: string, index: number): string {
  const parts = stored.split(':');
  const bytes = Buffer.from(parts[index], 'base64');
  bytes[0] ^= 0xff;
  parts[index] = bytes.toString('base64');
  return parts.join(':');
}

describe('createFieldCipher', () => {
  it.each(['Paciente relata tosse seca há 5 dias', 'J45.0', '', 'ç ã é 😷'])('decrypts what it encrypted: %j', (plaintext) => {
    expect(cipher.decrypt(cipher.encrypt(plaintext))).toBe(plaintext);
  });

  it('stores v1:<iv>:<tag>:<ciphertext> in base64 without the plaintext', () => {
    const stored = cipher.encrypt('Asma alérgica');

    const [version, iv, tag, ciphertext] = stored.split(':');
    expect(version).toBe('v1');
    expect(Buffer.from(iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(tag, 'base64')).toHaveLength(16);
    expect(ciphertext).not.toBe('');
    expect(stored).not.toContain('Asma');
  });

  it('uses a different IV for the same plaintext', () => {
    const first = cipher.encrypt('J45.0');
    const second = cipher.encrypt('J45.0');

    expect(first).not.toBe(second);
    expect(first.split(':')[1]).not.toBe(second.split(':')[1]);
  });

  it('fails to decrypt a tampered authentication tag', () => {
    expect(() => cipher.decrypt(tamper(cipher.encrypt('J45.0'), 2))).toThrow();
  });

  it('fails to decrypt a tampered ciphertext', () => {
    expect(() => cipher.decrypt(tamper(cipher.encrypt('Broncodilatador'), 3))).toThrow();
  });

  it('fails to decrypt with a different key', () => {
    const stored = cipher.encrypt('J45.0');

    expect(() => createFieldCipher(randomBytes(32)).decrypt(stored)).toThrow();
  });

  it.each(['plain text', 'v2:a:b:c', 'v1:a:b'])('rejects the unsupported stored value %j', (stored) => {
    expect(() => cipher.decrypt(stored)).toThrow('Unsupported encrypted field format');
  });

  it.each([16, 31, 33])('rejects a key with %i bytes', (length) => {
    expect(() => createFieldCipher(randomBytes(length))).toThrow('Field cipher key must have 32 bytes');
  });
});
