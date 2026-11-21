import type { RequestInfoLike } from '@serverless-jwt/jwt-verifier/adapter';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { createApp, defineEventHandler, toNodeListener } from 'h3';
import { createServer, request } from 'node:http';
import { expect, it } from 'vite-plus/test';

import type { CancellationSetup } from '../../testkit/src/conformance/node-cancellation.spec.ts';

import { listen, wireStatus } from '../../testkit/src/conformance/node-wire.ts';
import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { getAuth, jwtMiddleware } from './index.ts';

it('checks guarded contexts, keeps public routes public and enforces raw duplicate orders', async () => {
  const key = await signingKey();
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      sub: 'one',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const app = createApp();
  app.use(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      jwksUri: 'https://issuer.example/jwks',
      fetch: async () => Response.json({ keys: [key.jwk] }),
      protect: ['/protected'],
    }),
  );
  app.use(
    '/public',
    defineEventHandler((event) => {
      expect(() => getAuth(event)).toThrow(JwtVerifierError);
      return 'public';
    }),
  );
  app.use(defineEventHandler((event) => getAuth(event).identity));
  await using server = await listen(createServer(toNodeListener(app)));
  expect(await wireStatus(server.port, [], '/public')).toBe(200);
  expect(await wireStatus(server.port, ['Bearer ' + token])).toBe(200);
  for (const pair of [
    ['Bearer ' + token, 'Basic invalid'],
    ['Basic invalid', 'Bearer ' + token],
  ]) {
    expect(await wireStatus(server.port, pair)).toBe(400);
  }

  expect(await wireStatus(server.port, [], '/bad%')).toBe(400);
});

it('keeps optional missing and explicit skip auth absent while reading the native header view', async () => {
  for (const optional of [false, true]) {
    const skip = (view: RequestInfoLike): boolean => {
      expect(view.header('x-probe')).toBe('one, two');
      expect(view.header('absent')).toBeUndefined();
      return true;
    };
    const app = createApp();
    app.use(
      jwtMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: ['/protected'],
        ...(optional ? { mode: 'optional' as const } : { skip }),
      }),
    );
    app.use(
      defineEventHandler((event) => {
        expect(event.context.auth).toBe(optional ? null : undefined);
        expect(() => getAuth(event)).toThrow(JwtVerifierError);
        return 'unauthed';
      }),
    );
    await using server = await listen(createServer(toNodeListener(app)));
    expect(
      (
        await fetch(`http://127.0.0.1:${server.port}/protected`, {
          headers: { 'x-probe': 'one, two' },
        })
      ).status,
    ).toBe(200);
  }
});

it('never rewrites a committed Node response when the error hook fails', async () => {
  let observed: unknown;
  const cause = new Error('hook failure');
  const app = createApp({
    onError: (error) => {
      observed = error.cause;
    },
  });
  app.use(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      protect: ['/protected'],
      onError: (_error, event) => {
        event.node.res.writeHead(418);
        event.node.res.end('committed');
        throw cause;
      },
    }),
  );
  await using server = await listen(createServer(toNodeListener(app)));
  expect(await wireStatus(server.port, [])).toBe(418);
  expect(observed).toBe(cause);
});

it('handles native request defaults and array-valued named headers without changing routing policy', async () => {
  const app = createApp();
  let decisions = 0;
  const middleware = jwtMiddleware({
    issuer: 'https://issuer.example',
    audience: 'api',
    protect: ['/'],
    skip: (view) => {
      decisions++;
      expect(view.url).toBe('/');
      expect(view.method).toBe('GET');
      expect(view.header('set-cookie')).toBe('one');
      return true;
    },
  });
  app.use(
    defineEventHandler(async (event): Promise<void> => {
      delete event.node.req.url;
      delete event.node.req.method;
      await middleware(event);
    }),
  );
  app.use(defineEventHandler(() => 'skipped'));
  await using server = await listen(createServer(toNodeListener(app)));
  expect(
    await (
      await fetch(`http://127.0.0.1:${server.port}/protected`, { headers: { 'set-cookie': 'one' } })
    ).text(),
  ).toBe('skipped');
  expect(decisions).toBe(1);
});

it('cancels a fully consumed POST on physical disconnect and stops the h3 middleware chain', async () => {
  const { exerciseCompletedBodyDisconnect, exercisePreclosedResponse, exerciseFinishedResponse } =
    await import('../../testkit/src/conformance/node-cancellation.spec.ts');
  const { readRawBody } = await import('h3');
  const setup: CancellationSetup = async (options, observe, settled, handler) => {
    const app = createApp({ onError: () => {} });
    const middleware = jwtMiddleware({ ...options, protect: ['/protected'] });
    app.use(
      defineEventHandler(async (event): Promise<void> => {
        await readRawBody(event);
        await observe(event.node.req, event.node.res);
        try {
          await middleware(event);
        } finally {
          settled(event.node.req, event.node.res);
        }
      }),
    );
    app.use(
      defineEventHandler((event) => {
        handler(event.node.req, event.node.res);
      }),
    );
    const server = await listen(createServer(toNodeListener(app)));
    return { port: server.port, close: () => server[Symbol.asyncDispose]() };
  };
  const result = await exerciseCompletedBodyDisconnect(setup);
  expect(await exercisePreclosedResponse(setup)).toEqual({ verifyCalls: 0 });
  expect(await exerciseFinishedResponse(setup)).toEqual({ aborted: false });
  expect(result).toEqual({ fetches: 1, handlers: ['second'] });
});

it('stops downstream middleware when an error hook disconnects the actual response', async () => {
  let entered = false;
  const app = createApp({ onError: () => {} });
  app.use(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      protect: ['/protected'],
      onError: (_error, event) => {
        event.node.res.destroy();
      },
    }),
  );
  app.use(
    defineEventHandler(() => {
      entered = true;
      return 'unreachable';
    }),
  );
  await using server = await listen(createServer(toNodeListener(app)));
  await expect(
    fetch(`http://127.0.0.1:${server.port}/protected`, { signal: AbortSignal.timeout(2_000) }),
  ).rejects.toThrow(TypeError);
  expect(entered).toBe(false);
});

it('preserves custom response bytes and falls back before committing an unreadable hook body', async () => {
  for (const broken of [false, true]) {
    const diagnostics: unknown[] = [];
    const errors: unknown[] = [];
    let entered = false;
    const app = createApp({
      onError: (error) => {
        errors.push(error);
      },
    });
    app.use(
      jwtMiddleware({
        issuer: 'https://issuer.example',
        audience: 'api',
        protect: ['/protected'],
        onIntegrationDiagnostic: (event) => {
          diagnostics.push(event);
        },
        onError: () =>
          new Response(
            broken
              ? new ReadableStream({
                  start(controller) {
                    controller.error(new Error('unreadable body'));
                  },
                })
              : new Uint8Array([255, 0, 128]),
            {
              status: 418,
              headers: {
                'content-type': 'application/octet-stream',
                'x-custom': 'present',
                'cache-control': 'no-store',
              },
            },
          ),
      }),
    );
    app.use(
      defineEventHandler(() => {
        entered = true;
        return 'unreachable';
      }),
    );
    await using server = await listen(createServer(toNodeListener(app)));
    const response = await fetch(`http://127.0.0.1:${server.port}/protected`);
    expect(response.status).toBe(broken ? 401 : 418);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const expectedBody = broken
      ? new TextEncoder().encode(
          JSON.stringify({
            error: 'missing_token',
            error_description: 'A bearer token is required.',
          }),
        )
      : new Uint8Array([255, 0, 128]);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...expectedBody]);
    expect(response.headers.get('x-custom')).toBe(broken ? null : 'present');
    expect(diagnostics).toEqual(broken ? [{ type: 'integration.on_error_failed' }] : []);

    expect(errors).toEqual([]);
    expect(entered).toBe(false);
  }
});

it('leaves a committed native response intact when the hook also returns a custom body', async () => {
  const diagnostics: unknown[] = [];
  let entered = false;
  const app = createApp();
  app.use(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      protect: ['/protected'],
      onIntegrationDiagnostic: (event) => {
        diagnostics.push(event);
      },
      onError: (_error, event) => {
        event.node.res.writeHead(418);
        event.node.res.end('committed');
        return new Response('unused custom body', { status: 403 });
      },
    }),
  );
  app.use(
    defineEventHandler(() => {
      entered = true;
      return 'unreachable';
    }),
  );
  await using server = await listen(createServer(toNodeListener(app)));
  const response = await fetch(`http://127.0.0.1:${server.port}/protected`);
  expect(response.status).toBe(418);
  expect(await response.text()).toBe('committed');
  expect(diagnostics).toEqual([]);
  expect(entered).toBe(false);
});

it('preserves separate custom Set-Cookie fields including an Expires comma on the actual wire', async () => {
  const cookies = [
    'first=one; Expires=Wed, 11 Nov 2037 00:00:00 GMT; HttpOnly; Path=/',
    'second=two; Secure; Path=/',
  ];
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie);
  }

  const app = createApp();
  app.use(
    jwtMiddleware({
      issuer: 'https://issuer.example',
      audience: 'api',
      protect: ['/protected'],
      onError: () => new Response('custom', { status: 418, headers }),
    }),
  );
  await using server = await listen(createServer(toNodeListener(app)));
  const received = await new Promise<ReadonlyArray<string>>((resolve, reject) => {
    const outgoing = request(
      { host: '127.0.0.1', port: server.port, path: '/protected' },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.headersDistinct['set-cookie'] ?? []));
      },
    );
    outgoing.once('error', reject);
    outgoing.end();
  });
  expect(received).toEqual(cookies);
});
