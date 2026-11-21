import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import express from 'express';
import { createServer } from 'node:http';
import { expect, it } from 'vite-plus/test';

import type { CancellationSetup } from '../../testkit/src/conformance/node-cancellation.spec.ts';

import { listen, wireStatus } from '../../testkit/src/conformance/node-wire.ts';
import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { jwt, getAuth, requireScopes } from './index.ts';

it('rejects both raw TCP duplicate orders before a handler and enforces route scopes', async () => {
  const key = await signingKey();
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      sub: 'one',
      exp: Math.floor(Date.now() / 1000) + 300,
      scope: 'read',
    },
  });
  const app = express();
  app.use(
    jwt({
      issuer: 'https://issuer.example',
      audience: 'api',
      jwksUri: 'https://issuer.example/jwks',
      fetch: async () => Response.json({ keys: [key.jwk] }),
    }),
  );
  app.get('/protected', (_request, response) => response.json({}));
  const configuredScopes = ['admin'];
  const admin = requireScopes(configuredScopes);
  configuredScopes[0] = 'read';
  app.get('/admin', admin, (_request, response) => response.json({}));
  app.get('/read', requireScopes(['read'], 'any'), (request, response) =>
    response.json(getAuth(request).identity),
  );
  await using server = await listen(createServer(app));
  expect(await wireStatus(server.port, ['Bearer ' + token])).toBe(200);
  for (const pair of [
    ['Bearer ' + token, 'Basic invalid'],
    ['Basic invalid', 'Bearer ' + token],
  ]) {
    expect(await wireStatus(server.port, pair)).toBe(400);
  }

  expect(await wireStatus(server.port, ['Bearer ' + token], '/admin')).toBe(403);
  expect(await wireStatus(server.port, ['Bearer ' + token], '/read')).toBe(200);
});

it('keeps committed hook output and follows Express error middleware after a hook failure', async () => {
  for (const fail of [false, true]) {
    const app = express();
    const events: unknown[] = [];
    let seen: unknown;
    const cause = new Error('application hook failure');
    app.use(
      jwt({
        issuer: 'https://issuer.example',
        audience: 'api',
        onIntegrationDiagnostic: (event) => events.push(event),
        onError: (_error, _request, response) => {
          response.status(418).end('committed');
          if (fail) {
            throw cause;
          }
        },
      }),
    );
    app.use(
      (
        error: unknown,
        _request: express.Request,
        _response: express.Response,
        _next: express.NextFunction,
      ) => {
        seen = error;
      },
    );
    await using server = await listen(createServer(app));
    const response = await fetch(`http://127.0.0.1:${server.port}/protected`);
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('committed');
    expect(seen).toBe(fail ? cause : undefined);
    expect(events).toHaveLength(fail ? 1 : 0);
  }
});

it('fails the checked accessor for public and optional missing routes', async () => {
  const app = express();
  app.use(jwt({ issuer: 'https://issuer.example', audience: 'api', mode: 'optional' }));
  app.use((request, response) => {
    expect(() => getAuth(request)).toThrow(JwtVerifierError);
    response.end();
  });
  await using server = await listen(createServer(app));
  expect(await wireStatus(server.port, [])).toBe(200);
});

it('validates error-hook return values and reads the original header view before an explicit skip', async () => {
  const app = express();
  app.use(
    '/hook',
    jwt({
      issuer: 'https://issuer.example',
      audience: 'api',
      onError: () => 42 as unknown as void,
    }),
  );
  app.use(
    '/skip',
    jwt({
      issuer: 'https://issuer.example',
      audience: 'api',
      skip: (view) => {
        expect(view.header('x-probe')).toBe('present');
        expect(view.header('absent')).toBeUndefined();
        return true;
      },
    }),
  );
  app.use('/skip', (_request, response) => response.end('skipped'));
  await using server = await listen(createServer(app));
  expect((await fetch(`http://127.0.0.1:${server.port}/hook`)).status).toBe(401);
  expect(
    await (
      await fetch(`http://127.0.0.1:${server.port}/skip`, { headers: { 'x-probe': 'present' } })
    ).text(),
  ).toBe('skipped');
});

it('propagates unexpected accessor failures and keeps committed scope responses untouched', async () => {
  for (const committed of [false, true]) {
    const app = express();
    const cause = new Error('application accessor');
    let seen: unknown;
    app.use((request, response, next) => {
      if (committed) {
        response.status(418).end('committed');
      } else {
        Object.defineProperty(request, 'auth', {
          get: () => {
            throw cause;
          },
        });
      }

      next();
    });
    app.use(requireScopes(['read']));
    app.use(
      (
        error: unknown,
        _request: express.Request,
        response: express.Response,
        _next: express.NextFunction,
      ) => {
        seen = error;
        response.status(500).end('application-error');
      },
    );
    await using server = await listen(createServer(app));
    expect(await wireStatus(server.port, [])).toBe(committed ? 418 : 500);
    expect(seen).toBe(committed ? undefined : cause);
  }
});

it('cancels a fully consumed POST after actual socket disconnect and preserves a shared verifier waiter', async () => {
  const { exerciseCompletedBodyDisconnect, exercisePreclosedResponse, exerciseFinishedResponse } =
    await import('../../testkit/src/conformance/node-cancellation.spec.ts');
  const setup: CancellationSetup = async (options, observe, settled, handler) => {
    const app = express();
    app.use(express.text());
    const middleware = jwt(options);
    app.use(async (request, response, next) => {
      await observe(request, response);
      try {
        await middleware(request, response, next);
      } finally {
        settled(request, response);
      }
    });
    app.use((request, response) => handler(request, response));
    const server = await listen(createServer(app));
    return { port: server.port, close: () => server[Symbol.asyncDispose]() };
  };
  const result = await exerciseCompletedBodyDisconnect(setup);
  expect(await exercisePreclosedResponse(setup)).toEqual({ verifyCalls: 0 });
  expect(await exerciseFinishedResponse(setup)).toEqual({ aborted: false });
  expect(result).toEqual({ fetches: 1, handlers: ['second'] });
});
