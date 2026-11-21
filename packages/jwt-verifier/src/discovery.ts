import type { ResolvedOptions } from './options.ts';

import { boundedFetch } from './bounded-fetch.ts';
import { JwtVerifierError } from './errors.ts';
import { FetchBudget, FetchState } from './fetch-state.ts';
import { validEndpoint } from './options.ts';

/**
 * Per-verifier discovery cache with exact issuer trust checks and shared fetch ownership policy.
 */
export class Discovery {
  /**
   * Owned verifier configuration.
   */
  readonly #options: ResolvedOptions<unknown>;

  /**
   * Discovery ownership and outage state.
   */
  readonly #state: FetchState<string>;

  /**
   * Creates a discovery cache without starting I/O.
   */
  constructor(options: ResolvedOptions<unknown>, budget: FetchBudget = new FetchBudget(options)) {
    this.#options = options;
    this.#state = new FetchState(options, 'discovery', budget);
  }

  /**
   * Resolves the key endpoint for 24 hours; cross-origin HTTPS endpoints are permitted.
   */
  async get(): Promise<string> {
    const options = this.#options;
    if (this.#state.value && options.clock.now() < this.#state.fetchedAt + 86_400_000) {
      return this.#state.value;
    }

    return this.#state.load(async () => {
      const issuer = new URL(options.issuer);
      const url =
        options.discovery === 'oauth'
          ? `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname === '/' ? '' : issuer.pathname}${issuer.search}`
          : `${options.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const metadata = await boundedFetch(options, url, 'discovery');
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        Array.isArray(metadata) ||
        !('issuer' in metadata) ||
        metadata.issuer !== options.issuer ||
        !('jwks_uri' in metadata) ||
        !validEndpoint(metadata.jwks_uri, options.allowInsecureLocalhost)
      ) {
        throw new JwtVerifierError('discovery_invalid');
      }

      return metadata.jwks_uri;
    });
  }
}
