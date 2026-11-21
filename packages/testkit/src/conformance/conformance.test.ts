import { describe, expect, it } from 'vite-plus/test';

import type { AdapterHarness } from './types.ts';

import { referenceHarness } from './reference.ts';
import { defineConformanceSuite, runConformanceSuite } from './suite.ts';

const capabilities = { duplicateHeaders: true, streaming: true } as const;
defineConformanceSuite(referenceHarness, capabilities);

describe('conformance detects broken integrations', () => {
  for (const defect of ['scope', 'handler-error', 'isolation', 'comma'] as const) {
    it(`detects ${defect}`, async () => {
      let leaked: string | undefined;
      const broken: AdapterHarness = {
        name: 'broken/' + defect,
        setup: async (options, handler) => {
          const { scopes: _scopes, ...withoutScopes } = options;
          const app = await referenceHarness.setup(
            defect === 'scope' ? withoutScopes : options,
            handler,
          );
          return {
            send: async (request) => {
              try {
                const response = await app.send(
                  defect === 'comma'
                    ? {
                        ...request,
                        headers: (request.headers ?? []).map(
                          ([name, value]) => [name, value.split(',')[0] ?? value] as const,
                        ),
                      }
                    : request,
                );
                if (defect === 'isolation' && response.status === 200) {
                  leaked ??= response.body;
                  return { ...response, body: leaked };
                }

                return response;
              } catch (cause) {
                if (defect !== 'handler-error') {
                  throw cause;
                }

                return { status: 401, headers: {}, body: '{}' };
              }
            },
            [Symbol.asyncDispose]: () => app[Symbol.asyncDispose](),
          };
        },
      };
      const rows = await runConformanceSuite(broken, capabilities);
      expect(rows.filter((row) => row.result === 'fail').length).toBeGreaterThan(0);
      const expected = {
        scope: 'scopes-all',
        'handler-error': 'handler-error',
        isolation: 'isolation-200',
        comma: 'comma',
      }[defect];
      expect(rows.find((row) => row.case === expected)?.result).toBe('fail');
    }, 20_000);
  }
});

it.each(['description', 'challenge', 'extra-body-field'] as const)(
  'rejects independently corrupted public error responses: %s',
  async (defect) => {
    const corrupting: AdapterHarness = {
      name: 'broken/public-error-' + defect,
      setup: async (options, handler) => {
        const app = await referenceHarness.setup(options, handler);
        return {
          ...app,
          send: async (request) => {
            const response = await app.send(request);
            if (response.status < 400) {
              return response;
            }

            const body = JSON.parse(response.body);
            const headers = { ...response.headers };
            if (defect === 'description') {
              body.error_description = 'oops';
            } else if (defect === 'challenge') {
              if (response.status === 503) {
                headers['www-authenticate'] = 'Bearer error="invalid_token"';
              } else {
                delete headers['www-authenticate'];
              }
            } else {
              body.extra = 'unapproved';
            }

            return { ...response, headers, body: JSON.stringify(body) };
          },
        };
      },
    };
    const rows = await runConformanceSuite(corrupting, capabilities);
    for (const name of [
      'missing',
      'basic',
      'empty-bearer',
      'comma',
      'oversize',
      'expired',
      'audience',
      'issuer',
      'signature',
      'none',
      'scopes-all',
      'scopes-challenge',
      'scopes-any-denied',
      'optional-invalid',
      'forged-preflight',
      'already-aborted',
      'abort-shared-fetch',
      'onError-throw',
      'jwks-outage',
      'discovery-mismatch',
      'duplicateHeaders',
    ]) {
      expect(rows.find((row) => row.case === name)?.result, name).toBe('fail');
    }

    expect(rows.find((row) => row.case === 'valid-mapping-forwarding')?.result).toBe('pass');
    expect(rows.find((row) => row.case === 'streaming')?.result).toBe('pass');
  },
  20_000,
);

it('reports only explicit transport gaps while retaining every mandatory case', async () => {
  const rows = await runConformanceSuite(referenceHarness, {
    duplicateHeaders: {
      reason: 'Synthetic ingress drops duplicate lines',
      guarantee: 'Separate duplicate credentials cannot be detected',
    },
    streaming: {
      reason: 'Synthetic transport buffers responses',
      guarantee: 'Incremental response delivery is unavailable',
    },
  });
  expect(rows.filter((row) => row.result === 'fail')).toEqual([]);
  expect(rows.filter((row) => row.result === 'skip')).toEqual([
    {
      entrypoint: 'reference/fetch',
      case: 'duplicateHeaders',
      result: 'skip',
      reason:
        'Synthetic ingress drops duplicate lines; lost guarantee: Separate duplicate credentials cannot be detected',
    },
    {
      entrypoint: 'reference/fetch',
      case: 'streaming',
      result: 'skip',
      reason:
        'Synthetic transport buffers responses; lost guarantee: Incremental response delivery is unavailable',
    },
  ]);
  expect(rows.find((row) => row.case === 'comma')?.result).toBe('pass');
});

it('rejects a buffering harness claiming streaming support and releases its gated producer', async () => {
  const buffering: AdapterHarness = {
    name: 'broken/buffering',
    setup: async (options, handler) => {
      const app = await referenceHarness.setup(options, handler);
      return {
        ...app,
        stream: async (request, onChunk) => {
          const response = await app.send(request);
          onChunk(response.body);
          return response;
        },
      };
    },
  };
  const rows = await runConformanceSuite(buffering, capabilities);
  expect(rows.filter((row) => row.result === 'fail').map((row) => row.case)).toEqual(['streaming']);
}, 20_000);
