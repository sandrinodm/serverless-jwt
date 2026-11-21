import type {
  FunctionMiddlewareServerNextFn,
  FunctionServerResultWithContext,
  RequestServerNextFn,
  RequestServerResult,
} from '@tanstack/start-client-core';

import { createServerEntry } from '@tanstack/start-server-core';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';
import type { FunctionJwtMiddleware, JwtContext } from './index.ts';
import type { Mode, Skip, TanStackOptions } from './policy.ts';

import { responseHarness } from '../../testkit/src/conformance/response.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { jwtFunctionMiddleware, jwtMiddleware } from './index.ts';

/**
 * Native generic next signatures retain their actual SDK input and result types in the fixture.
 */
declare const requestNext: RequestServerNextFn<{}, undefined>;
/**
 * Native generic function next includes the SDK's server-only and serialized context contracts.
 */
declare const functionNext: FunctionMiddlewareServerNextFn<{}, unknown, undefined>;

for (const kind of ['request', 'function'] as const) {
  /**
   * Native createServerEntry establishes actual request scope for the function accessor.
   */
  const harness: AdapterHarness = {
    name: 'tanstack-start/' + kind,
    setup: async (options, handler) => {
      const { onError, ...policy } = options;
      const configured: TanStackOptions<unknown, Mode, Skip> = {
        ...policy,
        ...(onError
          ? {
              onError: (error, request) =>
                onError(error, { request }) as Promise<Response | undefined>,
            }
          : {}),
      };
      const requestCallback = kind === 'request' ? jwtMiddleware(configured) : undefined;
      const functionCallback = kind === 'function' ? jwtFunctionMiddleware(configured) : undefined;
      return responseHarness(async (spec) => {
        const request = new Request('https://start.example/api/me', {
          method: spec.method ?? 'GET',
          headers: spec.headers?.map(([name, value]) => [name, value]) ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        });
        let downstreamFailure: unknown;
        let failed = false;
        const entry = createServerEntry({
          fetch: async (original) => {
            if (original !== request) {
              throw new Error('Native request was replaced');
            }

            const dispatch = async (context: unknown): Promise<Response> =>
              handler((context as JwtContext<unknown, Mode, Skip> | undefined)?.auth, {
                env: 'test-env',
                ctx: 'test-ctx',
                params: 'test-params',
                context: 'test-context',
              });
            try {
              if (requestCallback) {
                const next = async <TContext = undefined>(
                  input?: Parameters<typeof requestNext<TContext>>[0],
                ): Promise<RequestServerResult<{}, undefined, TContext>> => ({
                  request,
                  pathname: '/api/me',
                  context: input?.context as RequestServerResult<
                    {},
                    undefined,
                    TContext
                  >['context'],
                  response: await dispatch(input?.context),
                });
                const result = await requestCallback({
                  request,
                  pathname: '/api/me',
                  context: undefined,
                  handlerType: 'router',
                  next,
                });
                return result instanceof Response ? result : result.response;
              }

              if (!functionCallback) {
                throw new Error('Missing function callback');
              }

              let response: Response | undefined;
              const next = async <TContext = undefined, TSendContext = undefined>(
                input?: Parameters<typeof functionNext<TContext, TSendContext>>[0],
              ): Promise<
                FunctionServerResultWithContext<{}, unknown, undefined, TContext, TSendContext>
              > => {
                response = await dispatch(input?.context);
                return {
                  'use functions must return the result of next()': true,
                  '~types': { context: input?.context, sendContext: input?.sendContext },
                  context: input?.context,
                  sendContext: input?.sendContext,
                } as FunctionServerResultWithContext<
                  {},
                  unknown,
                  undefined,
                  TContext,
                  TSendContext
                >;
              };
              const args: Parameters<FunctionJwtMiddleware<unknown, Mode, Skip>>[0] = {
                data: undefined,
                context: undefined,
                method: 'GET',
                serverFnMeta: { id: 'fixture', name: 'fixture', filename: 'fixture.ts' },
                signal: request.signal,
                next,
              };
              await functionCallback(args);
              if (!response) {
                throw new Error('Function middleware did not continue');
              }

              return response;
            } catch (cause) {
              if (cause instanceof Response) {
                return cause;
              }

              // The shared harness observes the original exception outside the native entry's
              // platform-owned error renderer; the library callback has already propagated it.
              failed = true;
              downstreamFailure = cause;
              return new Response('fixture error transport');
            }
          },
        });
        const response = await entry.fetch(request);
        if (failed) {
          throw downstreamFailure;
        }

        return response;
      });
    },
  };
  defineConformanceSuite(harness, { duplicateHeaders: true, streaming: true });
}
