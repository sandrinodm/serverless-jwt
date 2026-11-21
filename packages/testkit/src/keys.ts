import type { JWK } from 'jose';

import { exportJWK, generateKeyPair } from 'jose';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * A cached synthetic signing identity for key selection and algorithm confusion attacks.
 */
export interface SigningKey {
  /**
   * Private key used only to mint test credentials.
   */
  readonly privateKey: CryptoKey | ReturnType<typeof createPrivateKey>;

  /**
   * Advertised public key, including its stable selection identifier.
   */
  readonly jwk: JWK;
}

/**
 * Shares generated WebCrypto keys within one scenario process without pretending deterministic
 * seeds.
 */
const cache = new Map<string, Promise<SigningKey>>();

/**
 * Supplies RSA, EC or OKP signing identities to exercise algorithm restrictions and rotation.
 */
export function signingKey(alg = 'RS256', kid = 'valid'): Promise<SigningKey> {
  const id = `${alg}:${kid}`;
  let entry = cache.get(id);
  if (!entry) {
    entry = generateKeyPair(alg, { extractable: true }).then(async (pair) => ({
      privateKey: pair.privateKey,
      jwk: { ...(await exportJWK(pair.publicKey)), kid, alg, use: 'sig' },
    }));
    cache.set(id, entry);
  }

  return entry;
}

/**
 * Reads a committed RSA identity for undersized-key and x5c-only acceptance attacks.
 */
export function fixtureKey(bits: 1024 | 2048): SigningKey {
  const privateKey = createPrivateKey(
    readFileSync(new URL(`../fixtures/rsa-${bits}.pem`, import.meta.url)),
  );
  const certificate = new X509Certificate(
    readFileSync(new URL(`../fixtures/rsa-${bits}.crt`, import.meta.url)),
  );
  return {
    privateKey,
    jwk: {
      ...createPublicKey(privateKey).export({ format: 'jwk' }),
      kty: 'RSA',
      kid: 'valid',
      use: 'sig',
      x5c: [certificate.raw.toString('base64')],
    },
  };
}
