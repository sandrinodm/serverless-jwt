import { ConfigurationError, JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import Fastify from 'fastify';
import { expect, it } from 'vite-plus/test';

import type { CancellationSetup } from '../../testkit/src/conformance/node-cancellation.spec.ts';

import { wireStatus } from '../../testkit/src/conformance/node-wire.ts';
import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { serverlessJwt, getAuth } from './index.ts';

it('keeps public siblings public and isolates protected descendants with distinct issuers', async () => {
  const key = await signingKey();
  const options = {
    audience: 'api',
    jwksUri: 'https://keys.example/jwks',
    fetch: async () => Response.json({ keys: [key.jwk] }),
  };
  const app = Fastify();
  app.get('/public', () => ({ public: true }));
  for (const scope of ['one', 'two']) {
    await app.register(
      async (child) => {
        await child.register(serverlessJwt, {
          ...options,
          issuer: `https://${scope}.example`,
          global: true,
        });
        child.get('/me', (request) => getAuth<{ readonly sub: string }>(request).identity);
        await child.register(async (descendant) => {
          descendant.get('/descendant', (request) => getAuth(request).identity);
        });
      },
      { prefix: '/' + scope },
    );
  }

  try {
    expect((await app.inject('/public')).statusCode).toBe(200);
    for (const scope of ['one', 'two']) {
      expect((await app.inject('/' + scope + '/me')).statusCode).toBe(401);
      expect((await app.inject('/' + scope + '/descendant')).statusCode).toBe(401);
      const token = await mintToken({
        key,
        header: {},
        payload: {
          iss: `https://${scope}.example`,
          aud: 'api',
          sub: scope,
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      expect(
        (
          await app.inject({
            url: '/' + scope + '/me',
            headers: { authorization: 'Bearer ' + token },
          })
        ).json(),
      ).toMatchObject({ sub: scope });
      expect(
        (
          await app.inject({
            url: '/' + (scope === 'one' ? 'two' : 'one') + '/me',
            headers: { authorization: 'Bearer ' + token },
          })
        ).statusCode,
      ).toBe(401);
    }
  } finally {
    await app.close();
  }
});

it('opts routes in explicitly and rejects both duplicate orders on a real raw TCP server', async () => {
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
  const app = Fastify();
  await app.register(serverlessJwt, {
    issuer: 'https://issuer.example',
    audience: 'api',
    jwksUri: 'https://issuer.example/jwks',
    fetch: async () => Response.json({ keys: [key.jwk] }),
  });
  app.get('/public', (request) => {
    expect(() => getAuth(request)).toThrow(JwtVerifierError);
    return 'public';
  });
  app.get('/protected', { onRequest: app.authenticate }, (request) => getAuth(request).identity);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const port = Number(new URL(url).port);
    expect(await wireStatus(port, [], '/public')).toBe(200);
    expect(await wireStatus(port, [])).toBe(401);
    expect(await wireStatus(port, ['Bearer ' + token])).toBe(200);
    for (const pair of [
      ['Bearer ' + token, 'Basic invalid'],
      ['Basic invalid', 'Bearer ' + token],
    ]) {
      expect(await wireStatus(port, pair)).toBe(400);
    }
  } finally {
    await app.close();
  }
});

it('keeps committed replies and propagates hook failures through the native error path', async () => {
  for (const fail of [false, true]) {
    const app = Fastify();
    const events: unknown[] = [];
    const cause = new Error('hook failure');
    let seen: unknown;
    app.setErrorHandler((error, _request, _reply) => {
      seen = error;
    });
    await app.register(serverlessJwt, {
      issuer: 'https://issuer.example',
      audience: 'api',
      global: false,
      onIntegrationDiagnostic: (event) => events.push(event),
      onError: async (_error, _request, reply) => {
        await reply.code(418).send('committed');
        if (fail) {
          throw cause;
        }
      },
    });
    app.get(
      '/protected',
      {
        onRequest: async (request, reply) => {
          try {
            await app.authenticate.call(app, request, reply);
          } catch (error) {
            seen = error;
            throw error;
          }
        },
      },
      () => 'protected',
    );
    try {
      const response = await app.inject('/protected');
      expect(response.statusCode).toBe(418);
      expect(response.body).toBe('committed');
      expect(seen).toBe(fail ? cause : undefined);
      expect(events).toHaveLength(fail ? 1 : 0);
    } finally {
      await app.close();
    }
  }
});

it('validates hook return values and preserves the original named header view in skip policies', async () => {
  const app = Fastify();
  const views: unknown[] = [];
  await app.register(serverlessJwt, {
    issuer: 'https://issuer.example',
    audience: 'api',
    onError: () => 42 as unknown as void,
    skip: (view) => {
      if (view.url === '/skip') {
        views.push([view.header('x-probe'), view.header('set-cookie'), view.header('absent')]);
        return true;
      }

      return false;
    },
  });
  app.get('/hook', { onRequest: app.authenticate }, () => 'protected');
  app.get('/skip', { onRequest: app.authenticate }, () => 'skipped');
  try {
    expect((await app.inject('/hook')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/skip',
          headers: { 'x-probe': ['one', 'two'], 'set-cookie': ['one', 'two'] },
        })
      ).body,
    ).toBe('skipped');
    expect(views).toEqual([['one, two', 'one, two', undefined]]);
  } finally {
    await app.close();
  }
});

it('cancels a fully consumed POST after actual socket disconnect without authenticating its handler', async () => {
  const { exerciseCompletedBodyDisconnect, exercisePreclosedResponse, exerciseFinishedResponse } =
    await import('../../testkit/src/conformance/node-cancellation.spec.ts');
  const setup: CancellationSetup = async (options, observe, settled, handler) => {
    const app = Fastify();
    await app.register(serverlessJwt, options);
    app.post(
      '/protected',
      {
        preHandler: async (request, reply) => {
          await observe(request.raw, reply.raw);
          try {
            await app.authenticate.call(app, request, reply);
          } finally {
            settled(request.raw, reply.raw);
          }
        },
      },
      (request, reply) => {
        reply.hijack();
        handler(request.raw, reply.raw);
      },
    );
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    return { port: Number(new URL(address).port), close: () => app.close() };
  };
  const result = await exerciseCompletedBodyDisconnect(setup);
  expect(await exercisePreclosedResponse(setup)).toEqual({ verifyCalls: 0 });
  expect(await exerciseFinishedResponse(setup)).toEqual({ aborted: false });
  expect(result).toEqual({ fetches: 1, handlers: ['second'] });
});

it('stops route continuation when a rejection hook disconnects the actual response', async () => {
  const app = Fastify();
  let entered = false;
  await app.register(serverlessJwt, {
    issuer: 'https://issuer.example',
    audience: 'api',
    global: true,
    onError: (_error, _request, reply) => {
      reply.raw.destroy();
    },
  });
  app.get('/protected', () => {
    entered = true;
    return 'unreachable';
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    await expect(
      fetch(address + '/protected', { signal: AbortSignal.timeout(2_000) }),
    ).rejects.toThrow(TypeError);
    expect(entered).toBe(false);
  } finally {
    await app.close();
  }
});

it('stops protected handlers after an error hook commits streaming headers before completion', async () => {
  const app = Fastify();
  let entered = false;
  await app.register(serverlessJwt, {
    issuer: 'https://issuer.example',
    audience: 'api',
    global: true,
    onError: (_error, _request, reply) => {
      reply.raw.writeHead(418);
      reply.raw.write('committed');
      setImmediate(() => reply.raw.end());
    },
  });
  app.get('/protected', () => {
    entered = true;
    return 'unreachable';
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(address + '/protected');
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('committed');
    expect(entered).toBe(false);
  } finally {
    await app.close();
  }
});

it('rejects nonboolean global protection rather than silently registering an unguarded scope', async () => {
  const app = Fastify();
  app.register(serverlessJwt, {
    issuer: 'https://issuer.example',
    audience: 'api',
    global: 'true' as unknown as boolean,
  });
  try {
    await expect(app.ready()).rejects.toThrow(ConfigurationError);
  } finally {
    await app.close();
  }
});
