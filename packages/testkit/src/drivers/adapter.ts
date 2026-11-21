import type { JwtVerifierOptions } from '../../../jwt-verifier/src/index.ts';
import type { Driver } from './types.ts';

import { referenceHarness } from '../conformance/reference.ts';
import { coreDriver } from './core.ts';

/**
 * Runs the unchanged P1 disclosure catalogue through the actual reference response driver.
 */
export function adapterDriver(fetcher: typeof globalThis.fetch): Driver {
  const core = coreDriver(fetcher);
  const diagnostics: { readonly type: string; readonly reason?: string }[] = [];
  return {
    ...core,
    diagnostics: () => [...core.diagnostics(), ...diagnostics],
    respond: async (token, options) => {
      await using app = await referenceHarness.setup(
        {
          ...(options as JwtVerifierOptions<unknown>),
          fetch: fetcher,
          onDiagnostic: (event) => diagnostics.push(event),
        },
        () => Response.json({}),
      );
      const result = await app.send({ headers: [['authorization', 'Bearer ' + token]] });
      return { status: result.status, body: result.body };
    },
  };
}
