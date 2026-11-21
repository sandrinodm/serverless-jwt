import { decodeJwt } from 'jose';

import type { DriverAuth } from '../drivers/types.ts';
import type { Scenario } from './index.ts';

import { token } from './token.ts';

/**
 * Exercises mapClaims success shapes and null throws through the public verification boundary.
 */
export const mappingScenarios: ReadonlyArray<Scenario> = [
  'throws-null',
  'returns-primitive',
  'returns-object',
].map((name) => ({
  id: `mapping.${name}`,
  description: `mapClaims ${name}`,

  owner: 'core',
  issuer: () => ({}),

  expected:
    name === 'returns-object'
      ? { outcome: 'accepted', facts: { mappedIdentity: true, preservedClaims: true } }
      : { outcome: 'rejected', code: 'server_error', reason: 'mapping_failed', status: 500 },
  run: async (context) => {
    /**
     * Returns the selected adversarial mapping result or throws the null rejection reason.
     */
    const mapClaims = async (): Promise<unknown> => {
      if (name === 'throws-null') {
        throw null;
      }

      return name === 'returns-primitive'
        ? 42
        : { sub: 'mapped-subject', scope: 'mapped:scope', identity: 'mapped' };
    };
    context.driver.create({
      issuer: context.issuer.url,
      audience: 'api',
      mapClaims,
    });
    const jwt = await token(context, { sub: 'verified-subject', scope: 'verified:scope' });
    const result = await context.observe(() => context.driver.verify(jwt));
    if (name !== 'returns-object') {
      return result;
    }

    const auth = result.value as Partial<DriverAuth> | undefined;
    const original = decodeJwt(jwt);
    const identity = auth?.identity as Record<string, unknown> | undefined;
    return {
      ...result,
      facts: {
        mappedIdentity:
          identity?.sub === 'mapped-subject' &&
          identity?.scope === 'mapped:scope' &&
          identity?.identity === 'mapped',
        preservedClaims:
          auth?.claims !== undefined &&
          Object.keys(auth.claims).length === Object.keys(original).length &&
          Object.entries(original).every(([claim, value]) => auth.claims?.[claim] === value),
      },
    };
  },
}));
