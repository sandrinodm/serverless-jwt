import { readFileSync } from 'node:fs';

import type { Scenario } from './index.ts';

import { fixtureKey, signingKey } from '../keys.ts';
import { mintToken } from '../tokens.ts';
import { token } from './token.ts';

/**
 * Separately proves malformed conversion, ignored JWK metadata, duplicate selection and RSA
 * compatibility.
 */
export const keyScenarios: ReadonlyArray<Scenario> = [
  'conversion-breaking-x5c-poisons-valid-kid',
  'invalid-cert-bytes',
  'key-ops-sign-only',
  'duplicate-kid',
  'jwk-alg-mismatch',
  'x5c-only-rsa',
  'enc-only',
  'rsa-1024',
].map((name) => ({
  id: `keys.${name}`,
  description: `JWKS input ${name}`,

  owner: 'core',
  issuer: () => ({}),

  expected:
    name === 'duplicate-kid'
      ? {
          outcome: 'rejected',
          code: 'temporarily_unavailable',
          reason: 'jwks_invalid',
          status: 503,
          facts: {
            reversedOutcome: 'rejected',
            reversedCode: 'temporarily_unavailable',
            reversedReason: 'jwks_invalid',
            reversedStatus: 503,
          },
        }
      : {
          outcome: [
            'key-ops-sign-only',
            'duplicate-kid',
            'jwk-alg-mismatch',
            'enc-only',
            'rsa-1024',
          ].includes(name)
            ? 'rejected'
            : 'accepted',
        },
  run: async (context) => {
    const key = name === 'rsa-1024' ? fixtureKey(1024) : context.key;
    let keys: ReadonlyArray<unknown> = [key.jwk];
    if (name === 'conversion-breaking-x5c-poisons-valid-kid') {
      keys = [{ kty: 'RSA', kid: 'bad', x5c: [42] }, key.jwk];
    }

    if (name === 'invalid-cert-bytes') {
      keys = [
        {
          kty: 'RSA',
          kid: 'bad',
          x5c: [
            readFileSync(new URL('../../fixtures/invalid-cert.txt', import.meta.url)).toString(
              'base64',
            ),
          ],
        },
        key.jwk,
      ];
    }

    if (name === 'key-ops-sign-only') {
      keys = [{ ...key.jwk, key_ops: ['sign'] }];
    }

    if (name === 'duplicate-kid') {
      keys = [key.jwk, (await signingKey('RS256', 'valid')).jwk];
    }

    if (name === 'jwk-alg-mismatch') {
      keys = [{ ...key.jwk, alg: 'PS256' }];
    }

    if (name === 'x5c-only-rsa') {
      keys = [{ kty: 'RSA', kid: 'valid', x5c: key.jwk.x5c }];
    }

    if (name === 'enc-only') {
      keys = [{ ...key.jwk, use: 'enc' }];
    }

    context.issuer.setScript((path) => ({
      json: path.startsWith('/.well-known')
        ? { issuer: context.issuer.url, jwks_uri: `${context.issuer.url}/jwks` }
        : { keys },
    }));
    const jwt =
      name === 'rsa-1024'
        ? await mintToken({
            header: {},
            payload: { iss: context.issuer.url, aud: 'api', exp: context.clock.now() / 1000 + 300 },
            key,
          })
        : await token(context);
    const result = await context.observe(() => context.driver.verify(jwt));
    if (name === 'duplicate-kid') {
      context.driver.create({ issuer: context.issuer.url, audience: 'api' });
      keys = [...keys].reverse();
      const reversed = await context.observe(() => context.driver.verify(jwt));
      return {
        ...result,
        facts: {
          reversedOutcome: reversed.outcome,
          ...(reversed.code ? { reversedCode: reversed.code } : {}),
          ...(reversed.reason ? { reversedReason: reversed.reason } : {}),
          ...(reversed.status ? { reversedStatus: reversed.status } : {}),
        },
      };
    }

    return result;
  },
}));
