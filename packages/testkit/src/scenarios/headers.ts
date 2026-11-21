import type { Scenario } from './index.ts';

/**
 * Observes public extraction separately from JWT decoding, proving header grammar and size
 * behavior.
 */
export const headerScenarios: ReadonlyArray<Scenario> = [
  ['bearer-case', 'bearer x', 'accepted'],
  ['multiple-spaces', 'Bearer  x', 'accepted'],
  ['comma-joined', 'Bearer a, Bearer b', 'rejected'],
  ['oversized', `Bearer ${'x'.repeat(100_000)}`, 'accepted'],
].map(([name, header, expected]) => ({
  id: `headers.${name}`,
  description: `public header extraction: ${name}`,

  owner: 'core',
  issuer: () => ({}),

  expected: {
    outcome: expected as 'accepted' | 'rejected',
    ...(expected === 'rejected'
      ? { code: 'invalid_request', reason: 'multiple_credentials', status: 400 }
      : {}),
  },
  run: (context) => context.observe(() => context.driver.extract(header ?? '')),
}));

/**
 * Checks the verifier's size limit after bearer token extraction.
 */
export const oversizedPipelineScenario: Scenario = {
  /**
   * Stable length-check regression identifier.
   */
  id: 'headers.oversized-verification-pipeline',

  /**
   * Describes the extraction-plus-verification boundary.
   */
  description:
    '100kB credential is extracted, then passed through verify; 1.0 rejects before decoding',

  /**
   * Core verification owns the before-decode rejection.
   */
  owner: 'core',

  /**
   * No network is needed to reject malformed oversized credentials.
   */
  issuer: () => ({}),

  /**
   * Requires the public invalid-token code and internal size reason.
   */
  expected: { outcome: 'rejected', code: 'invalid_token', reason: 'token_too_large', status: 401 },

  /**
   * Exercises the complete credential pipeline through public driver methods.
   */
  run: (context) =>
    context.observe(() =>
      context.driver.verify(context.driver.extract(`Bearer ${'x'.repeat(100_000)}`)),
    ),
};
