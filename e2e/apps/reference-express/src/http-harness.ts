import type { ErrorRequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';

import express from 'express';
import { request as httpRequest } from 'node:http';

import type {
  AdapterHarness,
  RequestSpec,
  ResponseSpec,
} from '../../../../packages/testkit/src/conformance/types.ts';

import { referenceMiddleware } from './app.ts';

/**
 * Runs the complete contract through a real Express TCP listener and HTTP parser.
 */
export const httpHarness: AdapterHarness = {
  /**
   * Registers this actual HTTP entrypoint independently of the portable Fetch reference.
   */
  name: 'reference/express',

  /**
   * Constructs one middleware instance and a disposable real HTTP server per test configuration.
   */
  setup: async (options, handler) => {
    const app = express();
    const signals = new Map<string, AbortSignal>();
    const errors = new Map<string, unknown>();
    app.use(
      referenceMiddleware(options, handler, (request) =>
        signals.get(request.get('x-test-request-id') ?? ''),
      ),
    );
    /**
     * Retains identity only after Express itself receives the downstream error through next().
     */
    const errorPath: ErrorRequestHandler = (cause: unknown, request, response, _next): void => {
      errors.set(request.get('x-test-request-id') ?? '', cause);
      response.status(500).json({ error: 'test_application_error' });
    };
    app.use(errorPath);
    const server = app.listen(0, '127.0.0.1');
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
