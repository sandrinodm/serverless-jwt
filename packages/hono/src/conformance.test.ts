import type { RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import { Hono } from 'hono';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';
import type { JwtEnv } from './index.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { jwt } from './index.ts';

/**
 * Hono owns the actual app.request dispatch, native requests, context variables and error path.
 */
const harness: AdapterHarness = {
  name: 'hono/middleware',
  setup: async (options, handler) => {
    const app = new Hono<
      JwtEnv<unknown, 'required' | 'optional', (request: RequestInfoLike) => boolean>
    >();
    const { onError, ...policy } = options;
    app.onError((error) => {
      throw error;
    });
    app.use(
      '*',
      jwt<unknown, 'required' | 'optional'>({
        ...policy,
        ...(onError
          ? {
              onError: (error, context) =>
                onError(error, { context, request: context.req.raw }) as Promise<
                  Response | undefined
                >,
            }
          : {}),
      }),
    );
    app.all('/protected', (context) =>
      handler(context.var.auth, {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      }),
    );
    return responseHarness(async (spec) => {
      const request = new Request('https://hono.example/protected', {
        method: spec.method ?? 'GET',
        headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
        ...(spec.signal ? { signal: spec.signal } : {}),
      });
      return app.request(request);
    });
  },
};

defineConformanceSuite(harness, { duplicateHeaders: true, streaming: true });
