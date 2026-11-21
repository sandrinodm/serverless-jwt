import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { withJwt } from './index.ts';

/**
 * Native Web requests and original optional platform context drive the actual Vercel wrapper.
 */
const harness: AdapterHarness = {
  name: 'vercel/web',
  setup: async (options, handler) => {
    const context = { marker: 'test-context' };
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
        new Request('https://vercel.example/protected', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        }),
        context,
      ),
    );
  },
};

defineConformanceSuite(harness, {
  duplicateHeaders: {
    reason:
      'Vercel CLI 65.11.0 local Web-function ingress retains only the first Authorization line',
    guarantee:
      'Separate wire duplicates already discarded by that ingress cannot be rejected; joined values always reject',
  },
  streaming: true,
});
