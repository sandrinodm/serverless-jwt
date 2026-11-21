import type { IncomingMessage } from 'node:http';

import { createApp, defineEventHandler, toNodeListener } from 'h3';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';

import type {
  AdapterHarness,
  RequestSpec,
  ResponseSpec,
} from '../../testkit/src/conformance/types.ts';

import { writeResponse } from '../../testkit/src/conformance/node-response.ts';
import { jwtMiddleware } from './index.ts';

/**
 * Runs the complete contract through a real Express TCP listener and HTTP parser.
 */
export const httpHarness: AdapterHarness = {
  /**
   * Registers this actual HTTP entrypoint independently of the portable Fetch reference.
   */
  name: 'nuxt/h3-v1',

  /**
   * Constructs one middleware instance and a disposable real HTTP server per test configuration.
   */
  setup: async (options, handler) => {
    const app = createApp({
      onError: (error, event) => {
        errors.set(String(event.node.req.headers['x-test-request-id']), error.cause ?? error);
        event.node.res.statusCode = 500;
        event.node.res.end('application-error');
      },
    });
    const signals = new Map<string, AbortSignal>();
    const errors = new Map<string, unknown>();
    const { onError, ...policy } = options;
    app.use(
      defineEventHandler((event) => {
        const request = event.node.req;
        const signal = signals.get(String(request.headers['x-test-request-id']));
        const abort = (): void => {
          request.emit('aborted');
        };
        if (signal?.aborted) {
          Object.defineProperty(request, 'readableAborted', { value: true, configurable: true });
        } else {
          signal?.addEventListener('abort', abort, { once: true });
        }

        event.node.res.once('close', () => signal?.removeEventListener('abort', abort));
      }),
    );
    app.use(
      jwtMiddleware({
        ...policy,
        protect: ['/protected'],
        ...(onError
          ? {
              onError: async (error, event) =>
                onError(error, { event }) as Promise<Response | undefined>,
            }
          : {}),
      }),
    );
    app.use(
      defineEventHandler(async (event) => {
        await writeResponse(
          await handler(event.context.auth, {
            env: 'test-env',
            ctx: 'test-ctx',
            params: 'test-params',
            context: 'test-context',
          }),
          event.node.res,
        );
      }),
    );
    const server = createServer(toNodeListener(app)).listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('No TCP address');
    }

    const url = `http://127.0.0.1:${address.port}/protected`;
    let ordinal = 0;
    /**
     * Sends real header lines and observes real response bytes without aborting the client socket.
     */
    const send = async (
      spec: RequestSpec,
      onChunk?: (chunk: string) => void,
    ): Promise<ResponseSpec> => {
      const id = String(ordinal++);
      if (spec.signal) {
        signals.set(id, spec.signal);
      }

      try {
        const result = await new Promise<ResponseSpec>((resolve, reject) => {
          const headers = [
            ...(spec.headers ?? []).flatMap(([name, value]) => [name, value]),
            'host',
            new URL(url).host,
            'x-test-request-id',
            id,
          ];
          const request = httpRequest(
            url,
            { method: spec.method ?? 'GET', headers },
            (response: IncomingMessage) => {
              let body = '';
              response.setEncoding('utf8');
              response.on('data', (chunk: string) => {
                body += chunk;
                try {
                  onChunk?.(chunk);
                } catch (cause) {
                  reject(cause);
                  response.destroy();
                }
              });
              response.once('error', reject);
              response.once('end', () =>
                resolve({
                  status: response.statusCode ?? 0,
                  headers: Object.fromEntries(
                    Object.entries(response.headers).map(([name, value]) => [name, String(value)]),
                  ),
                  body,
                }),
              );
            },
          );
          request.setTimeout(10_000, () =>
            request.destroy(new Error('HTTP conformance request deadline exceeded')),
          );
          request.once('error', reject);
          request.end();
        });
        if (errors.has(id)) {
          const cause = errors.get(id);
          errors.delete(id);
          throw cause;
        }

        return result;
      } finally {
        signals.delete(id);
        errors.delete(id);
      }
    };
    return {
      send,
      stream: send,
      [Symbol.asyncDispose]: async (): Promise<void> => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      },
    };
  },
};
