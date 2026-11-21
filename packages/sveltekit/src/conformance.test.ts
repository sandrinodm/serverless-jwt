import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { eventFixture } from './event.test-helper.ts';
import { jwtHandle } from './index.ts';

/**
 * Native requests drive the registered hook; actual adapter builds and HTTP tests supply full Kit
 * events.
 */
const harness: AdapterHarness = {
  name: 'sveltekit/handle',
  setup: async (options, handler) => {
    const { onError, ...policy } = options;
    const handle = jwtHandle({
      ...policy,
      protect: ['/api/**'],
      ...(onError
        ? { onError: (error, event) => onError(error, { event }) as Promise<Response | undefined> }
        : {}),
    });
    return responseHarness(async (spec) => {
      const event = eventFixture(
        new Request('https://sveltekit.example/api/me', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        }),
      );
      return handle({
        event,
        resolve: async (passed) => {
          if (passed !== event) {
            throw new Error('Platform event was replaced');
          }

          return handler(event.locals.auth, {
            env: 'test-env',
            ctx: 'test-ctx',
            params: 'test-params',
            context: 'test-context',
          });
        },
      });
    });
  },
};

defineConformanceSuite(harness, {
  duplicateHeaders: {
    reason:
      'SvelteKit 3.1.1 adapter-node 6.0.1 ingress keeps only the first separate Authorization line',
    guarantee:
      'Separate wire duplicates discarded before Request construction cannot be recovered; native joined pairs still reject',
  },
  streaming: true,
});
