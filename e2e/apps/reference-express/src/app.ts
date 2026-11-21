import type { Request, RequestHandler, Response as ExpressResponse } from 'express';

import { authorizationFromNodeRequest, createGuard } from '@serverless-jwt/jwt-verifier/adapter';
import express from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type {
  TestOptions,
  TestHandler,
} from '../../../../packages/testkit/src/conformance/types.ts';

import { nodeCors, nodeStream } from '../capabilities.ts';

/**
 * Adapts Web-stream chunks to Node's pipeline without conflating their declaration packages.
 */
async function* bodyChunks(body: NonNullable<Response['body']>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        return;
      }

      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Pipes platform output incrementally while preserving backpressure and stream failure handling.
 */
async function writeResponse(output: Response, response: ExpressResponse): Promise<void> {
  response.status(output.status).set(Object.fromEntries(output.headers));
  if (!output.body) {
    response.end();
    return;
  }

  await pipeline(Readable.from(bodyChunks(output.body)), response);
}

/**
 * Private reference middleware; public Express integration remains P5 work.
 */
export function referenceMiddleware(
  options: TestOptions,
  handler: TestHandler,
  signalForRequest?: (request: Request) => AbortSignal | undefined,
): RequestHandler {
  const guard = createGuard(options);
  return async (request, response, next): Promise<void> => {
    const controller = new AbortController();
    /**
     * Converts disconnects into local verification cancellation.
     */
    const abort = (): void => {
      controller.abort();
    };
    request.once('aborted', abort);
    if (request.destroyed) {
      controller.abort();
    }

    try {
      const decision = await guard.decide(
        {
          method: request.method,
          url: request.originalUrl,
          authorization: authorizationFromNodeRequest(request),
          header: (name) => request.get(name),
        },
        signalForRequest?.(request) ?? controller.signal,
      );
      if (decision.kind === 'reject') {
        if (options.onError) {
          try {
            const custom = await options.onError(decision.error, { request, response });
            if (custom instanceof Response && !custom.bodyUsed && !custom.body?.locked) {
              await writeResponse(custom, response);
              return;
            }

            if (custom !== undefined) {
              guard.reportErrorHookFailure();
            }
          } catch (cause) {
            guard.reportErrorHookFailure();
            if (response.headersSent) {
              next(cause);
              return;
            }
          }
        }

        if (!response.headersSent) {
          response.status(decision.http.status).set(decision.http.headers).json(decision.http.body);
        }

        return;
      }

      // Application exceptions follow Express's own error path, outside authentication catches.
      if (
        process.env.E2E_REFERENCE_APP === '1' &&
        decision.kind === 'continue' &&
        decision.auth &&
        nodeStream(request, response, decision.auth.claims.sub)
      ) {
        return;
      }

      const output = await handler(decision.kind === 'skip' ? undefined : decision.auth, {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      });
      await writeResponse(output, response);
    } catch (cause) {
      next(cause);
    } finally {
      request.removeListener('aborted', abort);
    }
  };
}

/**
 * Starts the real HTTP example only when invoked by the subprocess harness.
 */
export function startExample(): void {
  const app = express();
  app.get('/ready', (_request, response) => {
    response.send('ready');
  });
  const options = {
    issuer: process.env.ISSUER ?? '',
    audience: 'https://resource.example',
    ...(process.env.E2E_KEY_POLICY
      ? { keys: JSON.parse(process.env.E2E_KEY_POLICY) as Record<string, number> }
      : {}),
    ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
  };
  app.use((request, response, next): void => {
    if (!nodeCors(request, response)) {
      next();
    }
  });
  app.use(
    '/protected',
    referenceMiddleware(options, (auth) =>
      Response.json({ sub: auth?.claims.sub, scopes: auth?.scopes }),
    ),
  );
  const server = app.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('No TCP listener');
    }

    process.send?.({ ready: `http://127.0.0.1:${address.port}` });
  });
  process.on('SIGTERM', () => {
    server.closeAllConnections();
    server.close(() => {
      process.exitCode = 0;
      process.disconnect?.();
    });
  });
}

if (process.env.E2E_REFERENCE_APP === '1') {
  startExample();
}
