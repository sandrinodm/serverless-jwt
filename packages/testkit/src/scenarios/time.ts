import type { Scenario } from './index.ts';

import { tokenScenario } from './token.ts';

/**
 * Freezes time to prove expiration, not-before and issued-at behavior including invalid Dates.
 */
export const timeScenarios: ReadonlyArray<Scenario> = [
  /**
   * Exp omitted. Scenario: time.missing-exp.
   */
  tokenScenario(
    'time.missing-exp',
    'exp omitted',
    { outcome: 'rejected', code: 'invalid_token', reason: 'claim_missing' },
    { payload: { exp: undefined } },
  ),
  /**
   * Exp before frozen now. Scenario: time.expired.
   */
  tokenScenario(
    'time.expired',
    'exp before frozen now',
    { outcome: 'rejected', code: 'invalid_token', reason: 'token_expired' },
    { payload: { exp: 1_799_999_990 } },
  ),
  /**
   * Nbf beyond tolerance. Scenario: time.nbf-future.
   */
  tokenScenario(
    'time.nbf-future',
    'nbf beyond tolerance',
    { outcome: 'rejected', code: 'invalid_token', reason: 'token_not_yet_valid' },
    { payload: { nbf: 1_800_000_100 } },
  ),
  /**
   * Iat beyond tolerance. Scenario: time.iat-future.
   */
  tokenScenario(
    'time.iat-future',
    'iat beyond tolerance',
    { outcome: 'rejected', code: 'invalid_token', reason: 'token_issued_in_future' },
    { payload: { iat: 1_800_000_100 } },
  ),
  /**
   * Exp now minus 4s; future tolerance 5s. Scenario: time.tolerance-boundary-inside.
   */
  tokenScenario(
    'time.tolerance-boundary-inside',
    'exp now minus 4s; future tolerance 5s',
    { outcome: 'accepted' },
    { payload: { exp: 1_799_999_996 } },
  ),
  /**
   * Exp now minus 6s; future tolerance 5s. Scenario: time.tolerance-boundary-outside.
   */
  tokenScenario(
    'time.tolerance-boundary-outside',
    'exp now minus 6s; future tolerance 5s',
    { outcome: 'rejected', code: 'invalid_token', reason: 'token_expired' },
    { payload: { exp: 1_799_999_994 } },
  ),
  /**
   * Exp outside the supported Date range. Scenario: time.extreme-exp.
   */
  tokenScenario(
    'time.extreme-exp',
    'exp outside the supported Date range',
    { outcome: 'rejected', code: 'invalid_token', reason: 'malformed_token' },
    { payload: { exp: -1e20 } },
  ),
  /**
   * Literal exp 1e400 signed without JSON reserialization. Scenario: time.overflow-exp.
   */
  tokenScenario(
    'time.overflow-exp',
    'literal exp 1e400 signed without JSON reserialization',
    { outcome: 'rejected', code: 'invalid_token', reason: 'malformed_token' },
    { raw: (c) => `{"iss":${JSON.stringify(c.issuer.url)},"aud":"api","exp":1e400}` },
  ),
];
