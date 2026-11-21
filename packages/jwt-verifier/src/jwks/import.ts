import type { JWK, JSONWebKeySet } from 'jose';

import { exportJWK, importJWK, importX509 } from 'jose';

import type { ResolvedOptions, Algorithm } from '../options.ts';

import { emit, safeKid } from '../diagnostics.ts';
import { JwtVerifierError } from '../errors.ts';

/**
 * Tests public key type and curve compatibility before handing selection to jose.
 */
export function compatible(key: JWK, alg: Algorithm): boolean {
  if (alg.startsWith('RS') || alg.startsWith('PS')) {
    return key.kty === 'RSA';
  }

  if (alg.startsWith('ES')) {
    return (
      key.kty === 'EC' &&
      key.crv ===
        ({ ES256: 'P-256', ES384: 'P-384', ES512: 'P-521' } as Record<string, string>)[alg]
    );
  }

  return key.kty === 'OKP' && key.crv === 'Ed25519';
}

/**
 * Measures actual unsigned modulus bits, including noncanonical leading zero octets.
 */
export function modulusBits(value: unknown): number {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return 0;
  }

  const bytes = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  let index = 0;
  while (index < bytes.length && bytes.charCodeAt(index) === 0) {
    index++;
  }

  return index === bytes.length
    ? 0
    : (bytes.length - index - 1) * 8 + (32 - Math.clz32(bytes.charCodeAt(index)));
}

/**
 * Tries only policy-compatible algorithms until the certificate's actual curve can be imported.
 */
async function importCertificate(
  certificate: string,
  candidates: ReadonlyArray<Algorithm>,
): Promise<JWK> {
  for (const algorithm of candidates) {
    try {
      const imported = await importX509(
        `-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`,
        algorithm,
        { extractable: true },
      );
      return await exportJWK(imported);
    } catch {
      // A certificate's EC curve may match a later allowed algorithm.
    }
  }

  throw new TypeError();
}

/**
 * Filters malformed, private, weak and policy-incompatible keys individually, retaining ambiguity.
 */
export async function importKeySet(
  raw: unknown,
  options: ResolvedOptions<unknown>,
  url: string,
): Promise<JSONWebKeySet> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('keys' in raw) ||
    !Array.isArray(raw.keys) ||
    raw.keys.length > options.keys.maxKeys
  ) {
    throw new JwtVerifierError('jwks_invalid');
  }

  const keys: JWK[] = [];
  for (const entry of raw.keys as unknown[]) {
    try {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError();
      }

      let key = { ...entry } as JWK;
      if (
        ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((name) => name in key) ||
        (key.use !== undefined && key.use !== 'sig') ||
        (key.key_ops !== undefined &&
          (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify'))) ||
        (key.alg !== undefined && !options.algorithms.includes(key.alg as Algorithm)) ||
        (key.kid !== undefined && typeof key.kid !== 'string')
      ) {
        throw new TypeError();
      }

      if ((key.kty === 'RSA' && !key.n) || (key.kty === 'EC' && !key.x)) {
        const certificate = key.x5c?.[0];
        if (typeof certificate !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(certificate)) {
          throw new TypeError();
        }

        const candidates = options.algorithms.filter(
          (alg) =>
            (key.alg === undefined || key.alg === alg) &&
            (key.kty === 'RSA'
              ? alg.startsWith('RS') || alg.startsWith('PS')
              : alg.startsWith('ES')),
        );
        const normalized = await importCertificate(certificate, candidates);
        key = {
          ...normalized,
          ...(key.kid !== undefined ? { kid: key.kid } : {}),
          ...(key.alg !== undefined ? { alg: key.alg } : {}),
          ...(key.use !== undefined ? { use: key.use } : {}),
          ...(key.key_ops !== undefined ? { key_ops: key.key_ops } : {}),
        };
      }

      const algorithms = options.algorithms.filter(
        (alg) => compatible(key, alg) && (key.alg === undefined || key.alg === alg),
      );
      if (
        !algorithms.length ||
        (key.kty === 'RSA' && modulusBits(key.n) < options.minRsaModulusLength)
      ) {
        throw new TypeError();
      }

      await importJWK(key, algorithms[0] as Algorithm);

      keys.push(key);
    } catch {
      const kid = await safeKid(
        entry && typeof entry === 'object' && 'kid' in entry ? entry.kid : undefined,
      );
      emit(options.onDiagnostic, {
        type: 'jwks.key_skipped',
        url,
        problem: 'invalid_key',
        ...(kid !== undefined ? { kid } : {}),
      });
    }
  }

  return { keys };
}
