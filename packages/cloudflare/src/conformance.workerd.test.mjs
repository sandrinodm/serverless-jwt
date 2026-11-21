import { createExecutionContext, env, SELF } from 'cloudflare:test';
import { expect, test } from 'vite-plus/test';

import { canShareInflight } from '../../jwt-verifier/src/runtime.ts';
import { defineConformanceSuite } from '../../testkit/src/conformance/suite.ts';
import { signingKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { jwtMiddleware, withJwt } from './index.ts';

/**
 * Normalizes real workerd responses while preserving incremental stream observations.
 */
async function normalize(response, onChunk) {
  let body = '';
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }

        const part = decoder.decode(chunk.value, { stream: true });
        body += part;
        onChunk?.(part);
      }

      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

/**
 * Builds native Workers and Pages entrypoints separately with original argument identity checks.
 */
function harness(form) {
  return {
    name: 'cloudflare/' + form,
    ioOwnership: 'request',
    async setup(options, handler) {
      const environment = { label: 'test-env', ASSETS: env.REPORT };
      const ctx = createExecutionContext();
      const params = { value: 'test-params' };
      const forwarded = {
        env: 'test-env',
        ctx: 'test-ctx',
        params: 'test-params',
        context: 'test-context',
      };
      const onError = options.onError;
      const configured = { ...options };
      delete configured.onError;
      const worker =
        form === 'workers'
          ? withJwt(
              {
                ...configured,
                ...(onError
                  ? {
                      onError: (error, request, passedEnv, passedCtx) =>
                        onError(error, { request, env: passedEnv, ctx: passedCtx }),
                    }
                  : {}),
              },
              (request, passedEnv, passedCtx, auth) => {
                expect(passedEnv).toBe(environment);
                expect(passedCtx).toBe(ctx);
                return handler(auth, forwarded);
              },
            )
          : undefined;
      const pages =
        form === 'pages'
          ? jwtMiddleware({
              ...configured,
              ...(onError ? { onError: (error, context) => onError(error, { context }) } : {}),
            })
          : undefined;
      const dispatch = async (spec) => {
        const request = new Request('https://resource.example/protected', {
          method: spec.method ?? 'GET',
          headers: spec.headers ?? [],
          ...(spec.signal ? { signal: spec.signal } : {}),
        });
        if (worker) {
          return worker(request, environment, ctx);
        }

        const data = {};
        const context = {
          request,
          env: environment,
          params,
          data,
          functionPath: '/protected',
          waitUntil: ctx.waitUntil.bind(ctx),
          passThroughOnException: ctx.passThroughOnException.bind(ctx),
          next: () => {
            expect(context.env).toBe(environment);
            expect(context.params).toBe(params);
            return Promise.resolve(handler(data.auth, forwarded));
          },
        };
        return pages(context);
      };
      const send = async (spec, onChunk) => normalize(await dispatch(spec), onChunk);
      return { send, stream: send, [Symbol.asyncDispose]: async () => {} };
    },
  };
}

for (const form of ['workers', 'pages']) {
  const adapter = harness(form);
  defineConformanceSuite(adapter, { duplicateHeaders: true, streaming: true }, async (results) => {
    const response = await env.REPORT.fetch('https://report.test/', {
      method: 'POST',
      body: JSON.stringify({ name: adapter.name, results }),
    });
    expect(response.status).toBe(204);
  });
}

test('native workerd never shares cross-request I/O and bounds cold verifier work', async () => {
  expect(canShareInflight()).toBe(false);
  const key = await signingKey();
  const token = await mintToken({
    header: {},
    key,
    payload: {
      iss: 'https://issuer.example',
      aud: 'api',
      sub: 'native',
      exp: Math.floor(Date.now() / 1000) + 300,
    },
  });
  await SELF.fetch('https://worker.test/reset', {
    method: 'POST',
    body: JSON.stringify({ token, jwk: key.jwk }),
  });
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => SELF.fetch('https://worker.test/')),
  );
  expect(replies.filter((response) => response.status === 200)).toHaveLength(2);
  expect(replies.filter((response) => response.status === 503)).toHaveLength(6);
  const bodies = await Promise.all(replies.map((response) => response.json()));
  expect(bodies.filter((body) => body.subject === 'native')).toHaveLength(2);
  expect(bodies.filter((body) => body.error === 'temporarily_unavailable')).toHaveLength(6);
  const facts = await (await SELF.fetch('https://worker.test/facts')).json();
  expect(facts).toEqual({ calls: 2, owners: 2 });
});
