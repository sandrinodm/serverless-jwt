import type { HandlerEvent } from '@netlify/functions';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { apiGatewayV1, context } from '../../testkit/fixtures/aws/events.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { withJwt } from './v1.ts';
/**
 * Each public event shape uses native typed fixtures and original context identities.
 */
function harness(): AdapterHarness {
  return {
    name: 'netlify/functions-v1',
    setup: async (options, handler) => {
      const signals = new WeakMap<object, AbortSignal>();
      const { onError, ...policy } = options;
      const settings = {
        ...policy,
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
                  headers: Object.fromEntries(result.headers),
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
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        };
      };
      // oxlint-disable-next-line typescript/no-deprecated -- This suite proves the explicitly transitional public entry.
      const wrapped = withJwt(settings, downstream);
      return {
        send: async (spec) => {
          const event: HandlerEvent = {
            ...apiGatewayV1(),
            rawUrl: 'https://resource.example/protected',
            rawQuery: '',
            queryStringParameters: {},
            multiValueQueryStringParameters: {},
          };
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
            event.multiValueHeaders = multi;
          }

          if (spec.signal) {
            signals.set(event, spec.signal);
          }

          const {
            identity: _identity,
            clientContext: _clientContext,
            ...nativeContext
          } = context();
          const result = await wrapped(event, {
            ...nativeContext,
            clientContext: { platform: 'original' },
          });
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
defineConformanceSuite(harness(), {
  duplicateHeaders: true,
  streaming: {
    reason: 'Buffered Netlify v1 proxy contract.',
    guarantee: 'Incremental response delivery is unavailable.',
  },
});
