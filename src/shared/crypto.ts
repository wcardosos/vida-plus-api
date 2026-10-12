import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const algorithm = 'aes-256-gcm';
const version = 'v1';
const keyLength = 32;
const ivLength = 12;
const tagLength = 16;

export type FieldCipher = {
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
};

export function createFieldCipher(key: Buffer): FieldCipher {
  if (key.length !== keyLength) {
    throw new Error(`Field cipher key must have ${keyLength} bytes`);
  }

  return {
    encrypt(plaintext) {
      const iv = randomBytes(ivLength);
      const cipher = createCipheriv(algorithm, key, iv, { authTagLength: tagLength });
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [version, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
    },

    decrypt(stored) {
      const parts = stored.split(':');
      if (parts.length !== 4 || parts[0] !== version) {
        throw new Error('Unsupported encrypted field format');
      }
      const [, iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
      if (iv.length !== ivLength || tag.length !== tagLength) {
        throw new Error('Unsupported encrypted field format');
      }
      const decipher = createDecipheriv(algorithm, key, iv, { authTagLength: tagLength });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
  };
}
