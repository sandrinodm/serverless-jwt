import type { Expectation, Scenario, ScenarioContext } from './index.ts';

import { mintToken, mintRaw } from '../tokens.ts';

/**
 * Builds a default valid token; overrides express individual claim or header attacks explicitly.
 */
export async function token(
  context: ScenarioContext,
  payload: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  rawPayload?: string,
): Promise<string> {
  const claims = {
    iss: context.issuer.url,
    aud: 'api',
    sub: 'subject',
    iat: Math.floor(context.clock.now() / 1000),
    exp: Math.floor(context.clock.now() / 1000) + 300,
    ...payload,
  };
  return rawPayload === undefined
    ? mintToken({ header, payload: claims, key: context.key })
    : mintRaw(JSON.stringify({ alg: 'RS256', kid: 'valid', ...header }), rawPayload, context.key);
}

/**
 * Defines one token validation attack without coupling it to a verifier constructor signature.
 */
export function tokenScenario(
  id: string,
  description: string,
  expected: Expectation,
  overrides: {
    readonly payload?: Record<string, unknown>;
    readonly header?: Record<string, unknown>;
    readonly configure?: (context: ScenarioContext) => void;
    readonly options?: Readonly<Record<string, unknown>>;
    readonly mint?: (context: ScenarioContext) => Promise<string>;
    readonly raw?: (context: ScenarioContext) => string;
  } = {},
): Scenario {
  return {
    id,
    description,

    expected,
    options: overrides.options ?? {},
    owner: 'core',
    issuer: () => ({}),
    run: async (context) => {
      overrides.configure?.(context);
      const jwt = overrides.mint
        ? await overrides.mint(context)
        : await token(context, overrides.payload, overrides.header, overrides.raw?.(context));
      return context.observe(() => context.driver.verify(jwt));
    },
  };
}
