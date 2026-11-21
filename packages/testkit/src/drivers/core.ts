import type {
  JwtVerifier,
  JwtVerifierOptions,
  Diagnostic,
} from '../../../jwt-verifier/src/index.ts';
import type { Driver } from './types.ts';

import {
  createJwtVerifier,
  getBearerToken,
  JwtVerifierError,
  removeNamespaces,
  claimToArray,
} from '../../../jwt-verifier/src/index.ts';

/**
 * Adapts the new public core API only; adapter response scenarios remain owned by P3.
 */
export function coreDriver(fetcher: typeof globalThis.fetch): Driver {
  let verifier: JwtVerifier<unknown>;
  const diagnostics: Diagnostic[] = [];
  return {
    create: (options) => {
      verifier = createJwtVerifier({
        ...options,
        fetch: fetcher,
        onDiagnostic: (event) => diagnostics.push(event),
      } as JwtVerifierOptions<unknown>);
    },
    verify: (token) => verifier.verify(token),
    extract: (header) => {
      const result = getBearerToken(header);
      if (!result.ok) {
        throw new JwtVerifierError(result.reason);
      }

      return result.token;
    },
    helpers: {
      removeNamespaces: (namespace, claims) => removeNamespaces(claims, namespace),
      claimToArray,
    },
    respond: async () => {
      throw new Error('P3 adapter response harness is not implemented in P2');
    },
    diagnostics: () => diagnostics,
  };
}
