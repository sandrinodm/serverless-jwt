import type { Auth, VerifiedClaims } from '@serverless-jwt/jwt-verifier';
import type { IntegrationOptions } from '@serverless-jwt/jwt-verifier/adapter';
import type { H3Event as NodeEvent } from 'h3';
import type { H3Event as WebEvent } from 'h3-v2';

import { ConfigurationError } from '@serverless-jwt/jwt-verifier';
import { createApp, defineEventHandler, toNodeListener } from 'h3';
import { H3, toNodeHandler } from 'h3-v2';
import { createServer } from 'node:http';
import { expect, it } from 'vite-plus/test';

import { listen } from '../../testkit/src/conformance/node-wire.ts';
import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { jwtMiddleware as webMiddleware } from './h3-v2.ts';
import { jwtMiddleware as nodeMiddleware } from './index.ts';

/**
 * Native host objects, rather than handwritten framework event shapes, drive both entrypoints.
 */
type NativeEvent = NodeEvent | WebEvent;

/**
 * Runs protection and downstream authentication observations through the real native HTTP hosts.
 */
async function predicateServer(
  major: number,
  options: IntegrationOptions,
  protect: (event: NativeEvent) => boolean,
  observe: (event: NativeEvent) => void,
  onError?: (error: unknown, event: NativeEvent) => Response,
): ReturnType<typeof listen> {
  const app = createApp();
  const web = new H3({ silent: true });
  const handler = (event: NativeEvent): string => {
    const auth = event.context.auth as Auth<unknown> | null | undefined;
    return JSON.stringify(
      auth === undefined ? 'undefined' : auth === null ? null : auth.claims.sub,
    );
  };
  if (major === 1) {
    app.use(defineEventHandler(observe));
    app.use(
      nodeMiddleware({
        ...options,
        protect: (event) => protect(event),
        ...(onError ? { onError } : {}),
      }),
    );
    app.use(defineEventHandler(handler));
  } else {
    web.use((event) => {
      observe(event);
    });
    web.use(
      webMiddleware({
        ...options,
        protect: (event: WebEvent) => protect(event),
        ...(onError ? { onError } : {}),
      }),
    );
    web.all('/**', handler);
  }

  return listen(createServer(major === 1 ? toNodeListener(app) : toNodeHandler(web)));
}

for (const major of [1, 2]) {
  it(
    'accepts a mandatory synchronous h3 v' +
      major +
      ' predicate without invoking it at construction',
    () => {
      const factory = (protect: unknown): void => {
        const options = {
          issuer: 'https://issuer.example',
          audience: 'api',
          protect: protect as never,
        };
        if (major === 1) {
          nodeMiddleware(options);
        } else {
          webMiddleware(options);
        }
      };
      let calls = 0;
      expect(() =>
        factory(() => {
          calls++;
          return true;
        }),
      ).not.toThrow();
      expect(calls).toBe(0);
      for (const protect of [undefined, null, {}, true, 12, '', [], [12], ['/api/*']]) {
        expect(() => factory(protect)).toThrow(ConfigurationError);
      }
    },
  );

  it(
    'preserves original h3 v' +
      major +
      ' event identity and public, required, optional and skipped auth states',
    async () => {
      const key = await signingKey();
      const token = await mintToken({
        key,
        header: {},
        payload: {
          iss: 'https://issuer.example',
          aud: 'api',
          sub: 'verified',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      for (const mode of ['required', 'optional', 'skip'] as const) {
        let native: NativeEvent | undefined;
        let decisions = 0;
        const server = await predicateServer(
          major,
          {
            issuer: 'https://issuer.example',
            audience: 'api',
            jwksUri: 'https://issuer.example/jwks',
            fetch: async () => Response.json({ keys: [key.jwk] }),
            ...(mode === 'optional'
              ? { mode: 'optional' as const }
              : mode === 'skip'
                ? { skip: () => true }
                : {}),
          },
          (event) => {
            decisions++;
            expect(event).toBe(native);
            expect(event.context.auth).toBeUndefined();
            const path = 'url' in event ? event.url.pathname : event.path;
            return path !== '/public';
          },
          (event) => {
            native = event;
          },
        );
        await using _running = server;
        const url = 'http://127.0.0.1:' + server.port;
        const publicResponse = await fetch(url + '/public', {
          headers: { authorization: 'Basic invalid' },
        });
        expect(publicResponse.status).toBe(200);
        expect(await publicResponse.json()).toBe('undefined');
        const missing = await fetch(url + '/protected');
        expect(missing.status).toBe(mode === 'required' ? 401 : 200);
        expect(await missing.json()).toEqual(
          mode === 'required'
            ? { error: 'missing_token', error_description: 'A bearer token is required.' }
            : mode === 'optional'
              ? null
              : 'undefined',
        );
        const invalid = await fetch(url + '/protected', {
          headers: { authorization: 'Bearer invalid' },
        });
        expect(invalid.status).toBe(mode === 'skip' ? 200 : 401);
        expect(await invalid.json()).toEqual(
          mode === 'skip'
            ? 'undefined'
            : { error: 'invalid_token', error_description: 'The token is malformed.' },
        );
        const authenticated = await fetch(url + '/protected', {
          headers: { authorization: 'Bearer ' + token },
        });
        expect(authenticated.status).toBe(200);
        expect(await authenticated.json()).toBe(mode === 'skip' ? 'undefined' : 'verified');
        expect(decisions).toBe(4);
      }
    },
  );

  it(
    'preserves earlier h3 v' + major + ' authentication when later selectors do not match',
    async () => {
      const key = await signingKey();
      const policy = { issuer: 'https://issuer.example', audience: 'api' };
      const token = await mintToken({
        key,
        header: {},
        payload: {
          iss: policy.issuer,
          aud: policy.audience,
          sub: 'verified',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      });
      const first = {
        ...policy,
        jwksUri: 'https://issuer.example/jwks',
        fetch: async () => Response.json({ keys: [key.jwk] }),
        protect: ['/**'],
      };
      const pathSelected = { ...policy, protect: ['/path-selected'], skip: () => true };
      const predicateSelected = {
        ...policy,
        protect: (event: NativeEvent): boolean => {
          const path = 'url' in event ? event.url.pathname : event.path;
          return path === '/predicate-selected';
        },
        skip: () => true,
      };
      const handler = (event: NativeEvent): string => {
        const auth = event.context.auth as Auth<unknown> | undefined;
        const subject = auth?.claims.sub;
        return typeof subject === 'string' ? subject : 'skipped';
      };
      const app = createApp();
      const web = new H3({ silent: true });
      if (major === 1) {
        app.use(nodeMiddleware(first));
        app.use(nodeMiddleware(pathSelected));
        app.use(nodeMiddleware(predicateSelected));
        app.use(defineEventHandler(handler));
      } else {
        web.use(webMiddleware(first));
        web.use(webMiddleware(pathSelected));
        web.use(webMiddleware<VerifiedClaims, WebEvent>(predicateSelected));
        web.all('/**', handler);
      }

      await using server = await listen(
        createServer(major === 1 ? toNodeListener(app) : toNodeHandler(web)),
      );
      for (const [path, expected] of [
        ['/unselected', 'verified'],
        ['/path-selected', 'skipped'],
        ['/predicate-selected', 'skipped'],
      ]) {
        const response = await fetch('http://127.0.0.1:' + server.port + path, {
          headers: { authorization: 'Bearer ' + token },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(expected);
      }
    },
  );

  it(
    'fails closed before h3 v' +
      major +
      ' authentication for thrown, nonboolean and asynchronous predicates',
    async () => {
      const invalid: ReadonlyArray<() => unknown> = [
        () => undefined,
        () => null,
        () => 0,
        () => 1,
        () => 'true',
        () => ({}),
        () => Promise.resolve(true),
        () => Promise.resolve(false),
        () => Promise.reject(new Error('private predicate failure')),
        () => ({
          // oxlint-disable-next-line unicorn/no-thenable -- Rejected callback thenables must be observed.
          then: (_resolve: unknown, reject: (error: Error) => void): void =>
            reject(new Error('private thenable failure')),
        }),
        () => ({
          // oxlint-disable-next-line unicorn/no-thenable -- A throwing then accessor must fail closed without leaking.
          get then(): never {
            throw new Error('private then accessor');
          },
        }),
        () => new Promise(() => {}),
        () => ({
          // oxlint-disable-next-line unicorn/no-thenable -- A throwing method must have its rejection observed.
          then: (): never => {
            throw new Error('private then method');
          },
        }),
        () => ({
          // oxlint-disable-next-line unicorn/no-thenable -- Refuse pending thenables without awaiting them.
          then: (): void => {},
        }),
        () => {
          throw new Error('private predicate exception');
        },
      ];
      for (const protect of invalid) {
        let entered = 0;
        let native: NativeEvent | undefined;
        await using server = await predicateServer(
          major,
          {
            issuer: 'https://issuer.example',
            audience: 'api',
            mode: 'optional',
            skip: () => {
              entered++;
              return true;
            },
          },
          protect as (event: NativeEvent) => boolean,
          (event) => {
            native = event;
          },
        );
        const response = await fetch('http://127.0.0.1:' + server.port + '/protected');
        expect(response.status).toBe(500);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
          error: 'server_error',
          error_description: 'The authentication adapter is misconfigured.',
        });
        expect(native?.context.auth).toBeUndefined();
        expect(entered).toBe(0);
      }

      // Allow rejection assimilation to run while Vitest's unhandled-rejection checks remain enabled.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  );

  it(
    'passes h3 v' +
      major +
      ' predicate failures and original events to the existing custom response hook',
    async () => {
      let native: NativeEvent | undefined;
      let observed: NativeEvent | undefined;
      await using server = await predicateServer(
        major,
        {
          issuer: 'https://issuer.example',
          audience: 'api',
        },
        () => {
          throw new Error('private policy failure');
        },
        (event) => {
          native = event;
        },
        (error, event) => {
          observed = event;
          expect(error).toMatchObject({ reason: 'adapter_misconfigured' });
          return new Response('custom policy rejection', { status: 418 });
        },
      );
      const response = await fetch('http://127.0.0.1:' + server.port + '/protected');
      expect(response.status).toBe(418);
      expect(await response.text()).toBe('custom policy rejection');
      expect(observed).toBe(native);
      expect(native?.context.auth).toBeUndefined();
    },
  );
}
