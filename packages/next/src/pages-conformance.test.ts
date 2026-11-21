import type { NextApiRequest, NextApiResponse } from 'next';

import { createMocks } from 'node-mocks-http';
import { EventEmitter } from 'node:events';

import type { AdapterHarness } from '../../testkit/src/conformance/types.ts';

import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { withJwtPages } from './pages.ts';

/**
 * Pages uses node-mocks-http's actual IncomingMessage/ServerResponse-compatible objects.
 */
const harness: AdapterHarness = {
  name: 'next/pages',
  setup: async (options, handler) => {
    const { onError, ...policy } = options;
    const wrapped = withJwtPages(
      {
        ...policy,
        ...(onError
          ? {
              onError: async (error, request, response) => {
                const custom = await onError(error, { request, response });
                if (custom !== undefined) {
                  if (!(custom instanceof Response) || custom.bodyUsed || custom.body?.locked) {
                    throw new Error('Unusable custom response');
                  }

                  response.status(custom.status);
                  custom.headers.forEach((value, name) => response.setHeader(name, value));
                  response.end(await custom.text());
                }
              },
            }
          : {}),
      },
      async (_request, response, auth) => {
        const result = await handler(auth, {
          env: 'test-env',
          ctx: 'test-ctx',
          params: 'test-params',
          context: 'test-context',
        });
        response.status(result.status);
        result.headers.forEach((value, name) => response.setHeader(name, value));
        response.end(await result.text());
      },
    );
    return {
      send: async (spec) => {
        const { req, res } = createMocks<NextApiRequest, NextApiResponse>(
          {
            method: (spec.method ?? 'GET') as 'GET',
            url: '/protected',
            headers: Object.fromEntries(spec.headers ?? []),
          },
          { eventEmitter: EventEmitter },
        );
        Object.defineProperty(req, 'rawHeaders', {
          value: (spec.headers ?? []).flatMap(([key, value]) => [key, value]),
        });
        const abort = (): void => {
          req.emit('aborted');
        };
        if (spec.signal?.aborted) {
          Object.defineProperty(req, 'readableAborted', { value: true });
        } else {
          spec.signal?.addEventListener('abort', abort, { once: true });
        }

        try {
          await wrapped(req, res);
          return {
            status: res.statusCode,
            headers: Object.fromEntries(
              Object.entries(res.getHeaders()).map(([name, value]) => [
                name.toLowerCase(),
                String(value),
              ]),
            ),
            body: res._getData() as string,
          };
        } finally {
          spec.signal?.removeEventListener('abort', abort);
        }
      },
      [Symbol.asyncDispose]: async (): Promise<void> => {},
    };
  },
};
defineConformanceSuite(harness, {
  duplicateHeaders: true,
  streaming: {
    reason: 'node-mocks-http buffers response writes.',
    guarantee: 'Incremental delivery requires the real next start app contract.',
  },
});
