import type { APIGatewayProxyEvent, APIGatewayProxyEventV2, ALBEvent } from 'aws-lambda';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { apiGatewayV1, apiGatewayV2, alb, context } from '../../testkit/fixtures/aws/events.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { withJwt } from './index.ts';

/**
 * Each public event shape uses native typed fixtures and original context identities.
 */
function harness(shape: 'apiGatewayV1' | 'apiGatewayV2' | 'alb', single = false): AdapterHarness {
  return {
    name: `aws-lambda/${shape}${single ? '-single-value' : ''}`,
    setup: async (options, handler) => {
      const signals = new WeakMap<object, AbortSignal>();
      const { onError, ...policy } = options;
      const settings = {
        ...policy,
        ...(single ? { albHeaders: 'single-value' as const } : {}),
        getSignal: (event: object) => signals.get(event),
        ...(onError
          ? {
              onError: async (
                error: Parameters<NonNullable<typeof onError>>[0],
                event: object,
                ctx: object,
              ) => {
                const result = await onError(error, { event, context: ctx });
                if (result === undefined) {
                  return undefined;
                }

                if (!(result instanceof Response)) {
                  throw new Error('Unusable custom response');
                }

                if (result.bodyUsed || result.body?.locked) {
                  throw new Error('Unusable custom response');
                }

                return {
                  statusCode: result.status,
                  ...(shape === 'alb' && !single
                    ? {
                        multiValueHeaders: Object.fromEntries(
                          [...result.headers].map(([name, value]) => [name, [value]]),
                        ),
                      }
                    : { headers: Object.fromEntries(result.headers) }),
                  body: await result.text(),
                };
              },
            }
          : {}),
      };
      const downstream = async (
        _event: unknown,
        _context: unknown,
        auth: Parameters<typeof handler>[0],
      ) => {
        const response = await handler(auth, {
          env: 'test-env',
          ctx: 'test-ctx',
          params: 'test-params',
          context: 'test-context',
        });
        return {
          statusCode: response.status,
          ...(shape === 'alb' && !single
            ? {
                multiValueHeaders: Object.fromEntries(
                  [...response.headers].map(([name, value]) => [name, [value]]),
                ),
              }
            : { headers: Object.fromEntries(response.headers) }),
          body: await response.text(),
        };
      };
      const wrapped =
        shape === 'apiGatewayV1'
          ? withJwt.apiGatewayV1(settings, downstream)
          : shape === 'apiGatewayV2'
            ? withJwt.apiGatewayV2(settings, downstream)
            : withJwt.alb(settings, downstream);
      return {
        send: async (spec) => {
          const event =
            shape === 'apiGatewayV1'
              ? apiGatewayV1()
              : shape === 'apiGatewayV2'
                ? apiGatewayV2()
                : alb();
          const headers: Record<string, string> = {};
          const multi: Record<string, string[]> = {};
          for (const [name, value] of spec.headers ?? []) {
            const key = name.toLowerCase();
            headers[key] = headers[key] === undefined ? value : headers[key] + ', ' + value;
            (multi[key] ??= []).push(value);
          }

          event.headers = headers;
          if ('httpMethod' in event) {
            event.httpMethod = spec.method ?? 'GET';
            if (single) {
              delete event.multiValueHeaders;
            } else {
              event.multiValueHeaders = multi;
            }
          } else {
            event.requestContext.http.method = spec.method ?? 'GET';
          }

          if (spec.signal) {
            signals.set(event, spec.signal);
          }

          const result = await (
            wrapped as (
              event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | ALBEvent,
              ctx: ReturnType<typeof context>,
            ) => Promise<{
              statusCode: number;
              headers?: Record<string, string | number | boolean>;
              multiValueHeaders?: Record<string, ReadonlyArray<string | number | boolean>>;
              body?: string;
            }>
          )(event, context());
          return {
            status: result.statusCode,
            headers: Object.fromEntries(
              Object.entries(result.headers ?? result.multiValueHeaders ?? {}).map(
                ([key, value]) => [
                  key.toLowerCase(),
                  Array.isArray(value) ? value.join(', ') : String(value),
                ],
              ),
            ),
            body: result.body ?? '',
          };
        },
        [Symbol.asyncDispose]: async (): Promise<void> => {},
      };
    },
  };
}
for (const shape of ['apiGatewayV1', 'apiGatewayV2', 'alb'] as const) {
  defineConformanceSuite(harness(shape), {
    duplicateHeaders: true,
    streaming: {
      reason: 'Buffered Lambda proxy result contract.',
      guarantee: 'Incremental response delivery is unavailable.',
    },
  });
}

defineConformanceSuite(harness('alb', true), {
  duplicateHeaders: {
    reason: 'ALB single-value target groups irreversibly discard repeated header lines.',
    guarantee: 'Duplicate-credential detection is impossible; callers explicitly opt in.',
  },
  streaming: {
    reason: 'Buffered ALB proxy result contract.',
    guarantee: 'Incremental response delivery is unavailable.',
  },
});
