import type { DefinedEnvVars } from '@sveltejs/kit/env';

import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Dynamic private environment is validated by the actual framework on each server startup.
 */
const configured: {
  readonly AUTH_REALM: { readonly schema: (value: string | undefined) => string };
  readonly ISSUER: { readonly schema: (value: string | undefined) => string };
  readonly JWKS_URI: { readonly schema: (value: string | undefined) => string };
} = {
  /**
   * Explicit endpoint challenges exercise the same configurable realm as the native guard.
   */
  AUTH_REALM: { schema: (value: string | undefined): string => value ?? 'api' },

  /**
   * Configured trusted issuer is private and evaluated by the framework at startup.
   */
  ISSUER: { schema: (value: string | undefined): string => value ?? 'https://issuer.example' },

  /**
   * An optional explicit JWKS endpoint is used by bounded local outage tests.
   */
  JWKS_URI: { schema: (value: string | undefined): string => value ?? '' },
};

/**
 * Both Node and Cloudflare adapters expose these through the generated private environment module.
 */
export const variables: DefinedEnvVars<typeof configured> = defineEnvVars(configured);
