import { RouterContextProvider } from 'react-router';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { createAuthContext, jwtMiddleware } from './index.ts';

/**
 * Real native request/context instances exercise the app-owned middleware and downstream boundary.
 */
const harness: AdapterHarness = {
  name: 'react-router/middleware',
  setup: async (options, handler) => {
    const auth = createAuthContext();
    const { onError, ...policy } = options;
    const middleware = jwtMiddleware({
      ...policy,
      context: auth,
      ...(onError
        ? { onError: (error, args) => onError(error, { args }) as Promise<Response | undefined> }
        : {}),
    });
    return responseHarness(async (spec) => {
      const context = new RouterContextProvider();
      const request = new Request('https://router.example/api/me', {
        method: spec.method ?? 'GET',
        headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
        ...(spec.signal ? { signal: spec.signal } : {}),
      });
      const response = await middleware(
        { request, context, params: { id: 'one' }, url: new URL(request.url), pattern: '/api/:id' },
        async () =>
          handler(context.get(auth), {
            env: 'test-env',
            ctx: 'test-ctx',
            params: 'test-params',
            context: 'test-context',
          }),
      );
      if (!(response instanceof Response)) {
        throw new Error('Middleware returned an unusable response');
      }

      return response;
    });
  },
};

defineConformanceSuite(harness, {
  duplicateHeaders: {
    reason:
      'React Router 8.5.1 react-router-serve ingress keeps only the first separate Authorization line',
    guarantee:
      'Separate wire duplicates discarded before Request construction cannot be recovered; native joined pairs still reject',
  },
  streaming: true,
});
