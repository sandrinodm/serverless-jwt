import { CompactSign } from 'jose';
import { sign } from 'node:crypto';

import type { SigningKey } from './keys.ts';

/**
 * Signs exact JSON bytes, preserving duplicate members, invalid JSON and overflowing numeric
 * literals.
 */
export async function mintRaw(header: string, payload: string, key: SigningKey): Promise<string> {
  const input = `${Buffer.from(header).toString('base64url')}.${Buffer.from(payload).toString('base64url')}`;
  const signature =
    key.privateKey instanceof CryptoKey
      ? Buffer.from(
          await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, Buffer.from(input)),
        )
      : sign('RSA-SHA256', Buffer.from(input), key.privateKey);
  return `${input}.${signature.toString('base64url')}`;
}

/**
 * Mints ordinary signed tokens for claim validation and valid algorithm compatibility scenarios.
 */
export async function mintToken(options: {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly key: SigningKey;
  readonly alg?: string;
}): Promise<string> {
  const alg = options.alg ?? 'RS256';
  if (alg === 'RS256') {
    return mintRaw(
      JSON.stringify({ alg, kid: 'valid', ...options.header }),
      JSON.stringify(options.payload),
      options.key,
    );
  }

  return new CompactSign(Buffer.from(JSON.stringify(options.payload)))
    .setProtectedHeader({ alg, kid: 'valid', ...options.header })
    .sign(options.key.privateKey);
}
