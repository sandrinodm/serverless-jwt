import { createHmac, createPublicKey } from 'node:crypto';

import type { Scenario } from './index.ts';

import { signingKey } from '../keys.ts';
import { mintToken } from '../tokens.ts';
import { token, tokenScenario } from './token.ts';

/**
 * Proves valid RSA compatibility and pre-check rejection of unsupported algorithms. Unknown
 * critical headers and remote header key pointers never authorize arbitrary keys.
 */
export const algorithmScenarios: ReadonlyArray<Scenario> = [
  /**
   * Valid RS256 token. Scenario: alg.rs256-valid.
   */
  tokenScenario('alg.rs256-valid', 'valid RS256 token', { outcome: 'accepted' }),
  /**
   * Unsigned algorithm pre-check. Scenario: alg.none.
   */
  tokenScenario(
    'alg.none',
    'unsigned algorithm pre-check',
    { outcome: 'rejected', code: 'invalid_token' },
    {
      mint: async (context) =>
        `${(await token(context, {}, { alg: 'none' })).split('.').slice(0, 2).join('.')}.`,
    },
  ),
  /**
   * HMAC-SHA256 signed with the RSA public PEM as its secret; pre-check. Scenario:
   * alg.hs256-with-public-key-as-secret.
   */
  tokenScenario(
    'alg.hs256-with-public-key-as-secret',
    'HMAC-SHA256 signed with the RSA public PEM as its secret; pre-check',
    { outcome: 'rejected', code: 'invalid_token' },
    {
      mint: async (context) => {
        const input = (await token(context, {}, { alg: 'HS256' })).split('.').slice(0, 2).join('.');
        const secret = createPublicKey({ key: context.key.jwk, format: 'jwk' }).export({
          format: 'pem',
          type: 'spki',
        });
        return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
      },
    },
  ),
  /**
   * ES256 header rejected before key lookup. Scenario: alg.es256-when-only-rs256-allowed.
   */
  tokenScenario(
    'alg.es256-when-only-rs256-allowed',
    'ES256 header rejected before key lookup',
    { outcome: 'rejected', code: 'invalid_token' },
    {
      mint: async (context) =>
        mintToken({
          alg: 'ES256',
          key: await signingKey('ES256'),
          header: {},
          payload: { iss: context.issuer.url, aud: 'api', exp: context.clock.now() / 1000 + 300 },
        }),
    },
  ),
  /**
   * Embedded attacker key and unreachable jku/x5u ignored. Scenario:
   * alg.header-jwk-jku-x5u-ignored.
   */
  tokenScenario(
    'alg.header-jwk-jku-x5u-ignored',
    'embedded attacker key and unreachable jku/x5u ignored',
    { outcome: 'accepted' },
    {
      header: {
        jwk: { kty: 'oct', k: 'attacker' },
        jku: 'https://invalid.example/jwks',
        x5u: 'https://invalid.example/cert',
      },
    },
  ),
  /**
   * Unknown critical extension is rejected. Scenario: alg.crit-unknown.
   */
  tokenScenario(
    'alg.crit-unknown',
    'unknown critical extension is rejected',
    { outcome: 'rejected', code: 'invalid_token' },
    { header: { crit: ['unknown'], unknown: true } },
  ),
];
