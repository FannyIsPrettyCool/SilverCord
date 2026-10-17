import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM sealing for secrets that must be recoverable (TOTP seeds). Layout: iv · tag · data. */
export interface SecretBox {
  seal(plaintext: Buffer): Buffer;
  open(sealed: Buffer): Buffer;
}

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('secret box key must be 32 bytes');
  return {
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    open(sealed) {
      const iv = sealed.subarray(0, IV_BYTES);
      const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]);
    },
  };
}
