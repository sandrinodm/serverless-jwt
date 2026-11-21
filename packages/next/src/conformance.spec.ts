import { NextRequest } from 'next/server.js';
import assert from 'node:assert/strict';

import type {
  AdapterHarness,
  Capabilities,
  TestHandler,
  TestOptions,
} from '../../testkit/src/conformance/types.ts';
import type { ProxyOptions } from './index.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { createProxyGuard, withJwt } from './index.ts';

/**
 * Creates a real guarded route once and checks original request/context identity on entry.
 */
function routeFixture(
  options: TestOptions,
  handler: TestHandler,
): (request: NextRequest) => Promise<Response> {
  const context = { params: Promise.resolve({ value: 'test-params' }) };
  const { onError, ...policy } = options;
  const route = withJwt(
    {
      ...policy,
      ...(onError
        ? {
            onError: (error, request, passedContext) =>
              onError(error, { request, context: passedContext }) as Promise<Response | undefined>,
          }
        : {}),
    },
    (request, passedContext, auth) => {
      assert.ok(request instanceof NextRequest);
      assert.equal(passedContext, context);
      return handler(auth, {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      });
    },
  );
  return (request: NextRequest): Promise<Response> => route(request, context);
}

/**
 * App Router registration preserves the actual NextRequest and original promised route context.
 */
export const routeHarness: AdapterHarness = {
  name: 'next/app-router',
  setup: async (options, handler) => {
    const route = routeFixture(options, handler);
    return responseHarness(async (spec) =>
      route(
        new NextRequest('https://resource.example/protected', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([key, value]) => [key, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        }),
      ),
    );
  },
};

/**
 * Proxy proof can replace only the proxy factory, leaving the independently guarded route intact.
 */
export type ProxyFactory = (
  options: ProxyOptions<unknown>,
) => (request: NextRequest) => Promise<Response | undefined>;

/**
 * Composes early rejection with required route verification, rejecting attempts to mask a fail-open
 * proxy.
 */
export function proxyHarness(factory: ProxyFactory = createProxyGuard): AdapterHarness {
  return {
    name: 'next/proxy',
    verificationStages: 2,
    setup: async (options: TestOptions, handler) => {
      const { onError, ...policy } = options;
      const guard = factory({
        ...policy,
        ...(onError
          ? {
              onError: (error, request) =>
                onError(error, { request }) as Promise<Response | undefined>,
            }
          : {}),
      });
      const route = routeFixture(options, handler);
      return responseHarness(async (spec) => {
        const request = new NextRequest('https://resource.example/protected', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([key, value]) => [key, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        });
        const headers = [...request.headers];
        const response = await guard(request);
        assert.deepEqual(
          [...request.headers],
          headers,
          'Proxy must not forward auth through request headers',
        );
        if (response !== undefined) {
          return response;
        }

        // A correct proxy must reject these before a correctly guarded route can hide its failure.
        const result = await route(request);
        assert.ok(result.status < 400, 'Proxy continued to a route that rejected authentication');
        return result;
      });
    },
  };
}

/**
 * Actual Next 16.4.5 next-start ingress drops later Authorization lines before NextRequest exists.
 */
export const nextCapabilities: Capabilities = {
  duplicateHeaders: {
    reason: 'Tested Next 16.4.5 Node next-start ingress keeps only the first Authorization line',
    guarantee:
      'The adapter cannot reject separate wire duplicates already discarded by this ingress; joined credentials still reject',
  },
  streaming: true,
};
