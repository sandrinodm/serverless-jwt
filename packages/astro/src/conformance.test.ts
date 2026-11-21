import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { contextFixture } from './context.test-helper.ts';
import { jwtMiddleware } from './index.ts';

/**
 * Native requests drive the registered hook; actual adapter builds and HTTP tests supply full Kit
 * events.
 */
const harness: AdapterHarness = {
  name: 'astro/middleware',
  setup: async (options, handler) => {
    const { onError, ...policy } = options;
    const middleware = jwtMiddleware({
      ...policy,
      protect: ['/api/**'],
      ...(onError
        ? { onError: (error, event) => onError(error, { event }) as Promise<Response | undefined> }
        : {}),
    });
    return responseHarness(async (spec) => {
      const context = contextFixture(
        new Request('https://astro.example/api/me', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        }),
      );
      return middleware(context, async () => {
        return handler(context.locals.auth, {
          env: 'test-env',
          ctx: 'test-ctx',
          params: 'test-params',
          context: 'test-context',
        });
      });
    });
  },
};

defineConformanceSuite(harness, {
  duplicateHeaders: {
    reason:
      'Astro 7.4.5 with @astrojs/node 11.1.9 standalone ingress keeps only the first separate Authorization line',
    guarantee:
      'Separate wire credentials discarded before Request construction cannot be recovered; native joined pairs still reject',
  },
  streaming: true,
});
