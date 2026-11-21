import type { IncomingMessage, ServerResponse } from 'node:http';

import assert from 'node:assert/strict';
import { request } from 'node:http';

import type { IntegrationOptions } from '../../../jwt-verifier/src/adapter.ts';

import { createJwtVerifier } from '../../../jwt-verifier/src/index.ts';
import { signingKey } from '../keys.ts';
import { mintToken } from '../tokens.ts';

/**
 * Real-framework setup gives the probe access only at the original request/response boundaries.
 */
export type CancellationSetup = (
  options: IntegrationOptions<unknown>,
  observe: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  settled: (request: IncomingMessage, response: ServerResponse) => void,
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) => Promise<{ readonly port: number; readonly close: () => Promise<void> }>;

/**
 * Bounds native event delivery independently of the verifier's unchanged timeout policy.
 */
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Native cancellation probe deadline')), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Proves completed POST bodies cancel through physical socket disconnect, without cancelling a
 * shared JWKS waiter.
 */
export async function exerciseCompletedBodyDisconnect(
  setup: CancellationSetup,
): Promise<{ readonly fetches: number; readonly handlers: ReadonlyArray<string> }> {
  const key = await signingKey();
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let both: () => void = () => {};
  const bothVerifying = new Promise<void>((resolve) => {
    both = resolve;
  });
  let cancelled: () => void = () => {};
  const firstCancelled = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  let finished: () => void = () => {};
  const firstSettled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let fetches = 0;
  let calls = 0;
  const handlers: string[] = [];
  const originals = new Map<
    string,
    {
      readonly request: IncomingMessage;
      readonly response: ServerResponse;
      readonly requestListeners: number;
      readonly responseListeners: number;
    }
  >();
  const verifier = createJwtVerifier({
    issuer: 'https://issuer.example',
    audience: 'api',
    jwksUri: 'https://issuer.example/jwks',
    fetch: async () => {
      fetches++;
      entered();
      await waiting;
      return Response.json({ keys: [key.jwk] });
    },
  });
  const app = await setup(
    {
      verifier: {
        ...verifier,
        verify: async (credential, options) => {
          calls++;
          if (calls === 1) {
            options?.signal?.addEventListener('abort', cancelled, { once: true });
          }

          if (calls === 2) {
            both();
          }

          return verifier.verify(credential, options);
        },
      },
    },
    (incoming, outgoing) => {
      assert.equal(
        incoming.readableEnded,
        true,
        'The framework must consume the complete POST body before authentication',
      );
      assert.equal(incoming.readableAborted, false);
      const id = String(incoming.headers['x-probe']);
      originals.set(id, {
        request: incoming,
        response: outgoing,
        requestListeners: incoming.listenerCount('aborted'),
        responseListeners: outgoing.listenerCount('close'),
      });
    },
    (incoming) => {
      if (incoming.headers['x-probe'] === 'first') {
        finished();
      }
    },
    (incoming, outgoing) => {
      handlers.push(String(incoming.headers['x-probe']));
      outgoing.end('authenticated');
    },
  );
  const url = `http://127.0.0.1:${app.port}/protected`;
  const first = request(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'x-probe': 'first',
      'content-type': 'text/plain',
      'content-length': '4',
    },
  });
  first.on('error', () => {});
  first.end('body');
  let second: ReturnType<typeof request> | undefined;
  try {
    await bounded(started);
    const secondResponse = new Promise<number>((resolve, reject) => {
      second = request(
        url,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + token,
            'x-probe': 'second',
            'content-type': 'text/plain',
            'content-length': '4',
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode ?? 0));
        },
      );
      second.once('error', reject);
      second.end('body');
    });
    void secondResponse.catch(() => {});
    await bounded(bothVerifying);
    first.destroy();
    await bounded(firstCancelled);
    await bounded(firstSettled);
    assert.deepEqual(
      handlers,
      [],
      'A disconnected unauthenticated caller must never reach the handler',
    );
    const original = originals.get('first');
    assert.ok(original);
    assert.equal(
      original.request.readableAborted,
      false,
      'The complete incoming body must not be treated as aborted',
    );
    assert.equal(original.response.destroyed, true);
    assert.ok(
      original.request.listenerCount('aborted') <= original.requestListeners,
      'Request abort listeners must be removed',
    );
    assert.ok(
      original.response.listenerCount('close') <= original.responseListeners,
      'Response close listeners must be removed',
    );
    release();
    assert.equal(await bounded(secondResponse), 200);
    assert.deepEqual(handlers, ['second']);
    assert.equal(fetches, 1, 'Caller cancellation must preserve shared JWKS I/O');
    return { fetches, handlers };
  } finally {
    release();
    first.destroy();
    second?.destroy();
    await app.close();
  }
}

/**
 * Proves an already-disconnected completed request fails before the verifier is called.
 */
export async function exercisePreclosedResponse(
  setup: CancellationSetup,
): Promise<{ readonly verifyCalls: number }> {
  let observed: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let finished: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let verifyCalls = 0;
  let handlers = 0;
  const verifier = createJwtVerifier({ issuer: 'https://issuer.example', audience: 'api' });
  const app = await setup(
    {
      verifier: {
        ...verifier,
        verify: async (token, options) => {
          verifyCalls++;
          return verifier.verify(token, options);
        },
      },
    },
    async (incoming, outgoing) => {
      assert.equal(incoming.readableEnded, true);
      const closed = new Promise<void>((resolve) => outgoing.once('close', resolve));
      observed();
      await closed;
      assert.equal(incoming.readableAborted, false);
      assert.equal(outgoing.destroyed, true);
      assert.equal(outgoing.writableFinished, false);
    },
    () => finished(),
    () => {
      handlers++;
    },
  );
  const client = request(`http://127.0.0.1:${app.port}/protected`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer fixed-placeholder',
      'content-type': 'text/plain',
      'content-length': '4',
    },
  });
  client.on('error', () => {});
  client.end('body');
  try {
    await bounded(ready);
    client.destroy();
    await bounded(ended);
    assert.equal(verifyCalls, 0);
    assert.equal(handlers, 0);
    return { verifyCalls };
  } finally {
    client.destroy();
    await app.close();
  }
}

/**
 * A normally completed response during pending authentication is not a caller cancellation.
 */
export async function exerciseFinishedResponse(
  setup: CancellationSetup,
): Promise<{ readonly aborted: boolean }> {
  const key = await signingKey();
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let settled: () => void = () => {};
  const completed = new Promise<void>((resolve) => {
    settled = resolve;
  });
  let outgoing: ServerResponse | undefined;
  let signal: AbortSignal | undefined;
  let verified = false;
  const verifier = createJwtVerifier({
    issuer: 'https://issuer.example',
    audience: 'api',
    jwksUri: 'https://issuer.example/jwks',
    fetch: async () => {
      entered();
      await waiting;
      return Response.json({ keys: [key.jwk] });
    },
  });
  const app = await setup(
    {
      verifier: {
        ...verifier,
        verify: async (credential, options) => {
          signal = options?.signal;
          const auth = await verifier.verify(credential, options);
          verified = true;
          return auth;
        },
      },
    },
    (_request, response) => {
      outgoing = response;
    },
    () => settled(),
    () => {},
  );
  let client: ReturnType<typeof request> | undefined;
  const response = new Promise<string>((resolve, reject) => {
    client = request(
      `http://127.0.0.1:${app.port}/protected`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'text/plain',
          'content-length': '4',
        },
      },
      (incoming) => {
        let body = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => {
          body += chunk;
        });
        incoming.once('end', () => resolve(body));
      },
    );
    client.once('error', reject);
    client.end('body');
  });
  void response.catch(() => {});
  try {
    await bounded(started);
    assert.ok(outgoing);
    assert.ok(signal);
    const closed = new Promise<void>((resolve) => outgoing?.once('close', resolve));
    outgoing.end('complete');
    await bounded(closed);
    assert.equal(await bounded(response), 'complete');
    assert.equal(signal.aborted, false);
    release();
    await bounded(completed);
    assert.equal(verified, true);
    assert.equal(signal.aborted, false);
    return { aborted: signal.aborted };
  } finally {
    release();
    client?.destroy();
    await app.close();
  }
}
