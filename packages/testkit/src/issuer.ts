import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Scripted response supports transport failures and bounded resource-exhaustion attacks.
 */
export interface IssuerReply {
  /**
   * JSON body returned unless a transport-specific response is requested.
   */
  readonly json?: unknown;

  /**
   * HTTP status, including discovery and JWKS failure responses.
   */
  readonly status?: number;

  /**
   * Delay before sending headers, in milliseconds.
   */
  readonly delay?: number;

  /**
   * Sends one byte per interval to exercise slow-drip timeouts.
   */
  readonly drip?: number;

  /**
   * Allocates a body of this many megabytes for body-size gates.
   */
  readonly megabytes?: number;

  /**
   * Redirect target for origin and downgrade policy tests.
   */
  readonly redirect?: string;

  /**
   * Destroys the connection before sending headers.
   */
  readonly reset?: boolean;
}

/**
 * Resolves each request using its path and per-path ordinal.
 */
export type IssuerScript = (path: string, hit: number) => IssuerReply;

/**
 * Starts a loopback-only HTTPS issuer; HTTP is an explicit downgrade fixture only.
 */
export async function startIssuer(options: {
  readonly script: IssuerScript;
  readonly tls?: boolean;
}): Promise<{
  readonly url: string;
  readonly hits: Record<string, number>;
  readonly maxConcurrent: Record<string, number>;
  readonly setScript: (script: IssuerScript) => void;
  readonly close: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}> {
  let script = options.script;
  const hits: Record<string, number> = {};
  const active: Record<string, number> = {};
  const maxConcurrent: Record<string, number> = {};
  const server =
    options.tls === false
      ? createHttpServer()
      : createHttpsServer({
          key: readFileSync(new URL('../fixtures/server-key.pem', import.meta.url)),
          cert: readFileSync(new URL('../fixtures/server.crt', import.meta.url)),
        });
  server.on('request', (request, response) => {
    const path = request.url ?? '/';
    active[path] = (active[path] ?? 0) + 1;
    maxConcurrent[path] = Math.max(maxConcurrent[path] ?? 0, active[path]);
    response.once('close', () => {
      active[path] = (active[path] ?? 1) - 1;
    });
    const reply = script(path, (hits[path] = (hits[path] ?? 0) + 1));
    if (reply.reset) {
      request.socket.destroy();
      return;
    }

    /**
     * Sends the selected scripted reply after any header delay.
     */

    const send = (): void => {
      response.writeHead(reply.redirect ? 302 : (reply.status ?? 200), {
        'content-type': 'application/json',
        ...(reply.redirect ? { location: reply.redirect } : {}),
      });
      const body = reply.megabytes
        ? 'x'.repeat(reply.megabytes * 1024 * 1024)
        : JSON.stringify(reply.json ?? {});
      if (reply.drip) {
        let offset = 0;
        const timer = setInterval(() => {
          response.write(body[offset++]);
          if (offset === body.length) {
            clearInterval(timer);
            response.end();
          }
        }, reply.drip);
        response.on('close', () => clearInterval(timer));
        return;
      }

      response.end(body);
    };
    if (reply.delay) {
      const timer = setTimeout(send, reply.delay);
      response.on('close', () => clearTimeout(timer));
    } else {
      send();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('issuer did not bind TCP');
  }

  /**
   * Closes active connections and awaits listener disposal.
   */

  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  return {
    url: `${options.tls === false ? 'http' : 'https'}://127.0.0.1:${address.port}`,
    hits,
    maxConcurrent,
    setScript(next: IssuerScript): void {
      script = next;
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}

/**
 * Creates a dedicated, verified test-CA fetch transport for future core conformance drivers.
 */
export function issuerTransport(): {
  readonly fetch: (
    input: string,
    init?: Parameters<typeof undiciFetch>[1],
  ) => ReturnType<typeof undiciFetch>;
  readonly close: () => Promise<void>;
} {
  const agent = new Agent({
    connect: { ca: readFileSync(new URL('../fixtures/ca.crt', import.meta.url)) },
  });
  return {
    fetch: (
      input: string,
      init?: Parameters<typeof undiciFetch>[1],
    ): ReturnType<typeof undiciFetch> => undiciFetch(input, { ...init, dispatcher: agent }),
    close: (): Promise<void> => agent.close(),
  };
}
