import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { contextFixture } from './context.test-helper.ts';
import { withJwt as edgeJwt } from './edge.ts';
import { withJwt as functionsJwt } from './index.ts';

/**
 * Native Web requests and original optional platform context drive the actual Vercel wrapper.
 */
function harness(name: string, withJwt: typeof functionsJwt): AdapterHarness {
  return {
    name,
    setup: async (options, handler) => {
      const context = contextFixture();
      const { onError, ...policy } = options;
      const route = withJwt(
        {
          ...policy,
          ...(onError
            ? {
                onError: (error, request, ctx) =>
                  onError(error, { request, context: ctx }) as Promise<Response | undefined>,
              }
            : {}),
        },
        (_request, ctx, auth) => {
          if (ctx !== context) {
            throw new Error('Platform context was replaced');
          }

          return handler(auth, {
            env: 'test-env',
            ctx: 'test-ctx',
            params: 'test-params',
            context: 'test-context',
          });
        },
      );
      return responseHarness(async (spec) =>
        route(
          new Request('https://netlify.example/protected', {
            method: spec.method ?? 'GET',
            headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
            ...(spec.signal ? { signal: spec.signal } : {}),
          }),
          context,
        ),
      );
    },
  };
}

defineConformanceSuite(harness('netlify/functions-v2', functionsJwt), {
  duplicateHeaders: {
    reason:
      'Netlify CLI 27.16.2 offline ingress retains only the first separate Authorization line in both Functions and Edge',
    guarantee:
      'Separate wire duplicates discarded by this local ingress cannot be recovered; joined values still reject',
  },
  streaming: true,
});
defineConformanceSuite(harness('netlify/edge', edgeJwt), {
  duplicateHeaders: {
    reason:
      'Netlify CLI 27.16.2 offline ingress retains only the first separate Authorization line in both Functions and Edge',
    guarantee:
      'Separate wire duplicates discarded by this local ingress cannot be recovered; joined values still reject',
  },
  streaming: true,
});
