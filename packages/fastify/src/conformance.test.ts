import Fastify from 'fastify';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { serverlessJwt } from './index.ts';

/**
 * Actual Fastify inject dispatch keeps original request/reply objects and plugin hooks.
 */
const harness: AdapterHarness = {
  name: 'fastify/plugin',
  setup: async (options, handler) => {
    const app = Fastify();
    const signals = new Map<string, AbortSignal>();
    const errors = new Map<string, unknown>();
    let ordinal = 0;
    app.addHook('onRequest', async (request, reply) => {
      const signal = signals.get(String(request.headers['x-test-id']));
      const abort = (): void => {
        request.raw.emit('aborted');
      };
      if (signal?.aborted) {
        Object.defineProperty(request.raw, 'readableAborted', { value: true, configurable: true });
      } else {
        signal?.addEventListener('abort', abort, { once: true });
      }

      reply.raw.once('close', () => signal?.removeEventListener('abort', abort));
    });
    app.setErrorHandler((error, request, reply) => {
      errors.set(String(request.headers['x-test-id']), error);
      void reply.code(500).send('application-error');
    });
    const { onError, ...policy } = options;
    await app.register(serverlessJwt, {
      ...policy,
      global: true,
      ...(onError
        ? {
            onError: async (error, request, reply) => {
              const custom = await onError(error, { request, reply });
              if (custom !== undefined) {
                if (!(custom instanceof Response) || custom.bodyUsed || custom.body?.locked) {
                  throw new Error('Unusable custom response');
                }

                await reply
                  .code(custom.status)
                  .headers(Object.fromEntries(custom.headers))
                  .send(await custom.text());
              }
            },
          }
        : {}),
    });
    app.all('/protected', async (request, reply) => {
      const response = await handler(request.auth, {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      });
      return reply
        .code(response.status)
        .headers(Object.fromEntries(response.headers))
        .send(await response.text());
    });
    await app.ready();
    return {
      send: async (spec) => {
        const id = String(ordinal++);
        if (spec.signal) {
          signals.set(id, spec.signal);
        }

        const headers: Record<string, string | string[]> = { 'x-test-id': id };
        for (const [name, value] of spec.headers ?? []) {
          const key = name.toLowerCase();
          const prior = headers[key];
          headers[key] =
            prior === undefined ? value : [...(Array.isArray(prior) ? prior : [prior]), value];
        }

        try {
          const response = await app.inject({
            method: (spec.method ?? 'GET') as 'GET',
            url: '/protected',
            headers,
          });
          if (errors.has(id)) {
            throw errors.get(id);
          }

          return {
            status: response.statusCode,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [key, String(value)]),
            ),
            body: response.body,
          };
        } finally {
          signals.delete(id);
          errors.delete(id);
        }
      },
      [Symbol.asyncDispose]: async (): Promise<void> => {
        await app.close();
      },
    };
  },
};
defineConformanceSuite(harness, {
  duplicateHeaders: true,
  streaming: {
    reason: 'Fastify inject buffers its response payload.',
    guarantee: 'Incremental response delivery is not observed through inject.',
  },
});
