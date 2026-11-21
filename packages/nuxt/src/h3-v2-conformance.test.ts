import { H3 } from 'h3-v2';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { jwtMiddleware } from './h3-v2.ts';

/**
 * Actual h3 v2 owns Web Requests and event contexts; downstream errors follow its onError path.
 */
const harness: AdapterHarness = {
  name: 'nuxt/h3-v2',
  setup: async (options, handler) => {
    let originalError: unknown;
    const app = new H3({
      debug: false,
      silent: true,
      onError: (error) => {
        originalError = error.cause ?? error;
        return new Response('application-error', { status: 500 });
      },
    });
    const { onError, ...policy } = options;
    app.use(
      jwtMiddleware({
        ...policy,
        protect: ['/protected'],
        ...(onError
          ? {
              onError: async (error, event) =>
                onError(error, { event }) as Promise<Response | undefined>,
            }
          : {}),
      }),
    );
    app.all('/protected', (event) =>
      handler(event.context.auth as Parameters<typeof handler>[0], {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      }),
    );
    return responseHarness(async (spec) => {
      originalError = undefined;
      const response = await app.fetch(
        new Request('https://resource.example/protected', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([key, value]) => [key, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        }),
      );
      if (originalError !== undefined) {
        throw originalError;
      }

      return response;
    });
  },
};
defineConformanceSuite(harness, { duplicateHeaders: true, streaming: true });
