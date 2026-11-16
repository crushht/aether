import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { DATA_DIR, filePath } from './store';

/**
 * One symmetric key per data directory, used wherever Aether has to keep a
 * secret it must later read back: model API keys, connector tokens and the
 * SMTP password. AES-256-GCM, so a tampered blob fails instead of decrypting
 * into something else.
 */

const SECRET_FILE = 'secret.key';

let secretPromise: Promise<string> | null = null;

async function secret(): Promise<string> {
  if (!secretPromise) {
    secretPromise = (async () => {
      try {
        const raw = (await fs.readFile(filePath(SECRET_FILE), 'utf8')).trim();
        if (raw.length >= 32) return raw;
      } catch {
        /* first run */
      }
      const created = randomBytes(32).toString('hex');
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(filePath(SECRET_FILE), created, { encoding: 'utf8', mode: 0o600 });
      return created;
    })();
  }
  return secretPromise;
}

async function key(): Promise<Buffer> {
  return secret().then((value) => createHash('sha256').update(value).digest());
}

/** AES-256-GCM, output `v1.iv.tag.ciphertext` (base64url parts). */
export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join(
    '.',
  );
}

export async function decryptSecret(blob: string): Promise<string> {
  if (!blob) return '';
  const [version, ivPart, tagPart, bodyPart] = blob.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !bodyPart) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(bodyPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
