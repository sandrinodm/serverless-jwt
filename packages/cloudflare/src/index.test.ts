import type {
  EventContext,
  ExportedHandlerFetchHandler,
  ExecutionContext,
} from '@cloudflare/workers-types';
import type { JwtVerifierOptions } from '@serverless-jwt/jwt-verifier';

import { describe, expect, it } from 'vite-plus/test';

import type { JwtData } from './index.ts';

import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { getAuth, jwtMiddleware, withJwt } from './index.ts';

/**
 * Node-focused policy tests complement the native workerd conformance registrations.
 */
const ctx = {} as ExecutionContext;
/**
 * Converts only the declaration boundary; the runtime remains the genuine Web Request.
 */
const request = (token?: string): Parameters<ExportedHandlerFetchHandler>[0] =>
  new Request('https://resource.example/api', {
    headers: token ? { authorization: 'Bearer ' + token } : {},
  }) as unknown as Parameters<ExportedHandlerFetchHandler>[0];

/**
 * Mints test credentials and supplies a counted key transport to observe verifier reuse.
 */
async function fixture(): Promise<{
  readonly token: string;
  readonly options: JwtVerifierOptions;
  readonly hits: string[];
}> {
  const key = await signingKey();
  const token = await mintToken({
    key,
    header: {},
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      sub: 'one',
      scope: 'read write',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  const hits: string[] = [];
  return {
    token,
    hits,
    options: {
      issuer: 'https://issuer.example',
      audience: 'api',
      jwksUri: 'https://issuer.example/one',
      fetch: async (url): Promise<Response> => {
        hits.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
        return Response.json({ keys: [key.jwk] });
      },
    },
  };
}

describe('Cloudflare policy ownership', () => {
  it('passes the header view to explicit skips and supplies undefined auth', async () => {
    const { options } = await fixture();
    const guarded = withJwt(
      {
        ...options,
        skip: (view) => {
          expect(view.header('missing')).toBeUndefined();
          expect(view.header('x-probe')).toBe('present');
          return true;
        },
      },
      (_request, _env, _ctx, auth) => {
        expect(auth).toBeUndefined();
        return Response.json({});
      },
    );
    const req = new Request('https://resource.example/api', { headers: { 'x-probe': 'present' } });
    expect(
      (await guarded(req as unknown as Parameters<ExportedHandlerFetchHandler>[0], {}, ctx)).status,
    ).toBe(200);
  });

  it('snapshots cached hook configuration before callers mutate a resolver result', async () => {
    const { options } = await fixture();
    const first = (): Response => new Response('first', { status: 418 });
    const second = (): Response => new Response('second', { status: 419 });
    const original = { ...options, onError: first };
    let current = original;
    const guarded = withJwt(
      () => current,
      () => Response.json({}),
    );
    expect((await guarded(request(), {}, ctx)).status).toBe(418);
    original.onError = second;
    expect((await guarded(request(), {}, ctx)).status).toBe(419);
    current = { ...options, onError: first };
    expect((await guarded(request(), {}, ctx)).status).toBe(418);
  });

  it('constructs one static verifier and forwards platform references untouched', async () => {
    const { token, options, hits } = await fixture();
    const env = { secret: 'test' };
    const req = request(token);
    const guarded = withJwt(options, (passed, passedEnv, passedCtx, auth) => {
      expect(passed).toBe(req);
      expect(passedEnv).toBe(env);
      expect(passedCtx).toBe(ctx);
      expect(auth.claims.sub).toBe('one');
      return Response.json({});
    });
    expect((await guarded(req, env, ctx)).status).toBe(200);
    expect((await guarded(req, env, ctx)).status).toBe(200);
    expect(hits).toHaveLength(1);
  });

  it('separates identical issuer/audience with different endpoints, scopes, and modes', async () => {
    const { token, options, hits } = await fixture();
    const guarded = withJwt(
      (env: { readonly policy: 'one' | 'two' | 'deny' | 'optional' }) => ({
        ...options,
        jwksUri: 'https://issuer.example/' + env.policy,
        ...(env.policy === 'deny' ? { scopes: ['admin'] } : {}),
        ...(env.policy === 'optional' ? { mode: 'optional' as const } : {}),
      }),
      (_req, _env, _ctx, auth) => Response.json({ auth: auth === null ? 'null' : 'present' }),
    );
    expect((await guarded(request(token), { policy: 'one' }, ctx)).status).toBe(200);
    expect((await guarded(request(token), { policy: 'two' }, ctx)).status).toBe(200);
    expect((await guarded(request(token), { policy: 'deny' }, ctx)).status).toBe(403);
    expect(await (await guarded(request(), { policy: 'optional' }, ctx)).json()).toEqual({
      auth: 'null',
    });
    expect((await guarded(request(), { policy: 'one' }, ctx)).status).toBe(401);
    expect(hits).toEqual([
      'https://issuer.example/one',
      'https://issuer.example/two',
      'https://issuer.example/deny',
    ]);
  });

  it('canonicalizes property order and nested policy while retaining ordered arrays', async () => {
    const { token, options, hits } = await fixture();
    const guarded = withJwt(
      (env: { readonly reverse: boolean; readonly ordered: boolean }) => {
        const policy = {
          ...options,
          scopes: env.ordered ? ['read', 'write'] : ['write', 'read'],
          keys: { cacheMaxAge: 60, cooldown: 30 },
        };
        return env.reverse
          ? (Object.fromEntries(Object.entries(policy).reverse()) as typeof policy)
          : policy;
      },
      () => Response.json({}),
    );
    for (const env of [
      { reverse: false, ordered: true },
      { reverse: true, ordered: true },
      { reverse: false, ordered: false },
    ]) {
      expect((await guarded(request(token), env, ctx)).status).toBe(200);
    }

    expect(hits).toHaveLength(2);
  });

  it('uses function identity and never aliases separate mapClaims closures', async () => {
    const { token, options } = await fixture();
    const first = (): { readonly value: number } => ({ value: 1 });
    const second = (): { readonly value: number } => ({ value: 2 });
    const guarded = withJwt(
      (env: { readonly second: boolean }) => ({
        ...options,
        mapClaims: env.second ? second : first,
      }),
      (_req, _env, _ctx, auth) => Response.json(auth.identity),
    );
    expect(await (await guarded(request(token), { second: false }, ctx)).json()).toEqual({
      value: 1,
    });
    expect(await (await guarded(request(token), { second: true }, ctx)).json()).toEqual({
      value: 2,
    });
  });

  it('retains at most eight guards and refreshes cache recency', async () => {
    const { token, options, hits } = await fixture();
    const guarded = withJwt(
      (env: number) => ({ ...options, jwksUri: 'https://issuer.example/' + env }),
      () => Response.json({}),
    );
    for (let index = 0; index < 8; index++) {
      await guarded(request(token), index, ctx);
    }

    await guarded(request(token), 0, ctx);
    await guarded(request(token), 8, ctx);
    await guarded(request(token), 0, ctx);
    expect(hits).toHaveLength(9);
    await guarded(request(token), 1, ctx);
    expect(hits).toHaveLength(10);
  });

  it('rejects unsupported and cyclic resolved configurations without reusing a guard', async () => {
    const { options } = await fixture();
    for (const extension of [Symbol('invalid'), 1n]) {
      const guarded = withJwt(
        () => ({ ...options, extension }),
        () => Response.json({}),
      );
      await expect(guarded(request(), {}, ctx)).rejects.toMatchObject({
        name: 'ConfigurationError',
      });
    }

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const guarded = withJwt(
      () => ({ ...options, cyclic }),
      () => Response.json({}),
    );
    await expect(guarded(request(), {}, ctx)).rejects.toMatchObject({ name: 'ConfigurationError' });
  });

  it('retains opaque object identities and handles null and absent optional fields', async () => {
    const { token, options, hits } = await fixture();
    class Clock {
      now(): number {
        return Date.now();
      }
    }
    const clocks = [new Clock(), new Clock()];
    const guarded = withJwt(
      (env: number) => ({
        ...options,
        ...(clocks[env] ? { clock: clocks[env] } : {}),
        unused: null,
      }),
      () => Response.json({}),
    );
    await guarded(request(token), 0, ctx);
    await guarded(request(token), 1, ctx);
    expect(hits).toHaveLength(2);
  });

  it('rejects invalid static options at factory time and preserves downstream failures', async () => {
    expect(() =>
      withJwt({ issuer: 'http://bad', audience: 'api' }, () => Response.json({})),
    ).toThrow('Invalid verifier configuration.');
    const { token, options } = await fixture();
    const failure = new Error('application');
    const guarded = withJwt(options, () => {
      throw failure;
    });
    await expect(guarded(request(token), {}, ctx)).rejects.toBe(failure);
  });

  it('awaits typed rejection hooks and isolates unusable responses and observer failures', async () => {
    const { options } = await fixture();
    const custom = withJwt(
      {
        ...options,
        onError: async (_error, req, env: { readonly marker: string }, passedCtx) => {
          await Promise.resolve();
          expect(req.method).toBe('GET');
          expect(env.marker).toBe('ok');
          expect(passedCtx).toBe(ctx);
          return new Response('custom', { status: 418 });
        },
      },
      () => Response.json({}),
    );
    expect((await custom(request(), { marker: 'ok' }, ctx)).status).toBe(418);
    const locked = new Response('locked');
    locked.body?.getReader();
    const consumed = new Response('used');
    await consumed.text();
    for (const result of [undefined, {}, locked, consumed]) {
      const events: unknown[] = [];
      const guarded = withJwt(
        {
          ...options,
          onError: async () => result as Response | undefined,
          onIntegrationDiagnostic: (event) => {
            events.push(event);
            throw null;
          },
        },
        () => Response.json({}),
      );
      expect((await guarded(request(), {}, ctx)).status).toBe(401);
      expect(events).toHaveLength(result === undefined ? 0 : 1);
    }

    const guarded = withJwt(
      {
        ...options,
        onError: async () => {
          throw null;
        },
      },
      () => Response.json({}),
    );
    expect((await guarded(request(), {}, ctx)).status).toBe(401);
  });
});

describe('Pages request data', () => {
  it('sets only request-owned data and preserves next failures', async () => {
    const { token, options } = await fixture();
    const context = {
      request: request(token),
      env: {},
      params: {},
      data: {},
      next: async () => Response.json({}),
    } as unknown as EventContext<unknown, string, JwtData>;
    const middleware = jwtMiddleware(options);
    expect((await middleware(context)).status).toBe(200);
    expect(context.data.auth).toMatchObject({ claims: { sub: 'one' } });
    expect(getAuth(context.data).claims.sub).toBe('one');
    expect(() => getAuth({})).toThrow('Authentication context is missing.');
    const failure = new Error('downstream');
    context.next = async () => {
      throw failure;
    };
    await expect(middleware(context)).rejects.toBe(failure);
  });

  it('clears stale auth for skipped and rejected contexts and handles typed hook fallback', async () => {
    const { options } = await fixture();
    const context = {
      request: request(),
      env: {},
      params: {},
      data: { auth: 'stale' },
      next: async () => Response.json({}),
    } as unknown as EventContext<unknown, string, JwtData>;
    const skipped = jwtMiddleware({ ...options, skip: () => true });
    await skipped(context);
    expect(context.data.auth).toBeUndefined();
    for (const result of [undefined, {}, new Response('custom', { status: 418 })]) {
      let observed = 0;
      const middleware = jwtMiddleware({
        ...options,
        onError: async (_error, original) => {
          expect(original).toBe(context);
          return result as Response | undefined;
        },
        onIntegrationDiagnostic: () => {
          observed++;
        },
      });
      expect((await middleware(context)).status).toBe(result instanceof Response ? 418 : 401);
      expect(observed).toBe(result !== undefined && !(result instanceof Response) ? 1 : 0);
      expect(context.data.auth).toBeUndefined();
    }

    const middleware = jwtMiddleware({
      ...options,
      onError: async () => {
        throw null;
      },
    });
    expect((await middleware(context)).status).toBe(401);
    const missing = jwtMiddleware(options);
    expect((await missing(context)).status).toBe(401);
  });
});
