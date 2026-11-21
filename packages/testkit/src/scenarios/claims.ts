import type { Scenario } from './index.ts';

import { tokenScenario } from './token.ts';

/**
 * Exercises exact issuer and audience checks plus the generic/RFC9068 profile migration boundary.
 */
export const claimScenarios: ReadonlyArray<Scenario> = [
  /**
   * API audience as string. Scenario: claims.aud-string.
   */
  tokenScenario('claims.aud-string', 'API audience as string', { outcome: 'accepted' }),
  /**
   * API audience in array. Scenario: claims.aud-array.
   */
  tokenScenario(
    'claims.aud-array',
    'API audience in array',
    { outcome: 'accepted' },
    { payload: { aud: ['other', 'api'] } },
  ),
  /**
   * Aud omitted. Scenario: claims.aud-missing.
   */
  tokenScenario(
    'claims.aud-missing',
    'aud omitted',
    { outcome: 'rejected', code: 'invalid_token', reason: 'claim_missing', status: 401 },
    { payload: { aud: undefined } },
  ),
  /**
   * Wrong audience. Scenario: claims.aud-wrong.
   */
  tokenScenario(
    'claims.aud-wrong',
    'wrong audience',
    { outcome: 'rejected', code: 'invalid_token', reason: 'claim_audience', status: 401 },
    { payload: { aud: 'other' } },
  ),
  /**
   * Issuer differs by trailing slash. Scenario: claims.iss-trailing-slash-mismatch.
   */
  tokenScenario(
    'claims.iss-trailing-slash-mismatch',
    'issuer differs by trailing slash',
    { outcome: 'rejected', code: 'invalid_token' },
    {
      raw: (c) =>
        JSON.stringify({ iss: `${c.issuer.url}/`, aud: 'api', exp: c.clock.now() / 1000 + 300 }),
    },
  ),
  /**
   * Typ JWT with default generic profile. Scenario: claims.typ-jwt-generic.
   */
  tokenScenario(
    'claims.typ-jwt-generic',
    'typ JWT with default generic profile',
    { outcome: 'accepted' },
    { header: { typ: 'JWT' } },
  ),
  /**
   * Typ JWT with future profile rfc9068. Scenario: claims.typ-jwt-rfc9068.
   */
  tokenScenario(
    'claims.typ-jwt-rfc9068',
    'typ JWT with future profile rfc9068',
    { outcome: 'rejected', code: 'invalid_token', reason: 'claim_type', status: 401 },
    {
      options: { profile: 'rfc9068' },
      header: { typ: 'JWT' },
      payload: { client_id: 'client', jti: 'id' },
    },
  ),
  /**
   * Typ at+jwt with future profile rfc9068. Scenario: claims.typ-at+jwt-rfc9068.
   */
  tokenScenario(
    'claims.typ-at+jwt-rfc9068',
    'typ at+jwt with future profile rfc9068',
    { outcome: 'accepted' },
    {
      options: { profile: 'rfc9068' },
      header: { typ: 'at+jwt' },
      payload: { client_id: 'client', jti: 'id' },
    },
  ),
  /**
   * ID token audience client checked against API audience. Scenario:
   * claims.id-token-wrong-aud-generic.
   */
  tokenScenario(
    'claims.id-token-wrong-aud-generic',
    'ID token audience client checked against API audience',
    { outcome: 'rejected', code: 'invalid_token', reason: 'claim_audience', status: 401 },
    { payload: { aud: 'client', azp: 'client' } },
  ),
  /**
   * RFC9068-shaped token missing client_id. Scenario: claims.rfc9068-missing-client_id.
   */
  tokenScenario(
    'claims.rfc9068-missing-client_id',
    'RFC9068-shaped token missing client_id',
    { outcome: 'rejected', code: 'invalid_token', reason: 'claim_missing', status: 401 },
    { options: { profile: 'rfc9068' }, header: { typ: 'at+jwt' }, payload: { jti: 'id' } },
  ),
];
