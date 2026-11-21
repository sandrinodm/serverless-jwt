import { getEventListeners } from 'node:events';
import { describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';

import type { Decision, IntegrationOptions, RequestInfoLike } from './adapter.ts';
import type { Auth, JwtVerifier } from './index.ts';

import {
  authorizationFromHeaders,
  authorizationFromLambdaEvent,
  authorizationFromNodeRequest,
  createGuard,
  toResponse,
} from './adapter.ts';
import { ConfigurationError, createJwtVerifier, JwtVerifierError } from './index.ts';
import * as verification from './verify.ts';

const options = { issuer: 'https://issuer.test', audience: 'api' };
const request: RequestInfoLike = {
  method: 'GET',
  url: 'https://api.test',
  authorization: [],
  header: () => undefined,
};
const auth: Auth<{ id: string }> = {
  claims: Object.freeze({ sub: 'subject' }),
  identity: { id: 'identity' },
  token: 'a.b.c',
  scopes: ['read'],
};
const verifier = (): JwtVerifier<{ id: string }> => ({
  verify: vi.fn(async () => auth),
  warmup: async () => {},
  issuer: options.issuer,
  audience: ['api'],
});

describe('guard factory', () => {
  it('constructs exactly one verifier in configuration mode across requests', async () => {
    const factory = vi.spyOn(verification, 'createJwtVerifier');
    const guard = createGuard(options);
    expect(factory).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 3; index++) {
      await guard.decide(request);
    }

    expect(factory).toHaveBeenCalledTimes(1);
  });
  it('skips before malformed credential handling without invoking the verifier', async () => {
    const existing = verifier();
    const guard = createGuard({ verifier: existing, skip: () => true });
    expect(await guard.decide({ ...request, authorization: ['Bearer a, b'] })).toEqual({
      kind: 'skip',
    });
    expect(existing.verify).not.toHaveBeenCalled();
  });
  it('authenticates when the synchronous skip predicate returns false', async () => {
    const existing = verifier();
    const guard = createGuard({ verifier: existing, skip: () => false });
    expect((await guard.decide(request)).kind).toBe('reject');
    expect((await guard.decide({ ...request, authorization: ['Bearer a.b.c'] })).kind).toBe(
      'continue',
    );
    expect(existing.verify).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['async false', async (): Promise<unknown> => false],
    ['async true', async (): Promise<unknown> => true],
    [
      'async rejection',
      async (): Promise<unknown> => {
        throw 'private-skip-secret';
      },
    ],
    ['string', (): unknown => 'private-skip-secret'],
    ['object', (): unknown => ({ secret: 'private-skip-secret' })],
    ['undefined', (): unknown => undefined],
    ['null', (): unknown => null],
    ['number', (): unknown => 1],
    ['zero', (): unknown => 0],
    [
      'thenable rejection',
      (): unknown => ({
        // oxlint-disable-next-line unicorn/no-thenable -- Deliberately malformed callback result.
        then: (_resolve: unknown, reject: (value: unknown) => void) =>
          reject('private-skip-secret'),
      }),
    ],
    [
      'throwing then',
      (): unknown => ({
        // oxlint-disable-next-line unicorn/no-thenable -- Deliberately malformed callback result.
        then: (): unknown => {
          throw 'private-skip-secret';
        },
      }),
    ],
    [
      'throwing then accessor',
      (): unknown => ({
        // oxlint-disable-next-line unicorn/no-thenable -- Deliberately throwing then accessor.
        get then(): never {
          throw 'private-skip-secret';
        },
      }),
    ],
    [
      'pending thenable',
      (): unknown => ({
        // oxlint-disable-next-line unicorn/no-thenable -- Must reject without waiting for settlement.
        then: (): unknown => undefined,
      }),
    ],
  ] as const)('fails closed for a malformed skip result: %s', async (_name, skip) => {
    const existing = verifier();
    const guard = createGuard({ verifier: existing, skip } as unknown as IntegrationOptions);
    const before = performance.now();
    const result = await guard.decide({ ...request, authorization: ['Bearer private-token'] });
    expect(performance.now() - before).toBeLessThan(50);
    expect(result.kind).toBe('reject');
    if (result.kind !== 'reject') {
      throw new Error('Expected rejection');
    }

    expect(result.error.reason).toBe('adapter_misconfigured');
    expect(result.http).toEqual({
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: {
        error: 'server_error',
        error_description: 'The authentication adapter is misconfigured.',
      },
    });
    expect(existing.verify).not.toHaveBeenCalled();
    // Let thenable assimilation and rejection handlers run; Vitest retains unhandled checks.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  it('preserves mode and identity types and rejects mixed configuration types', async () => {
    const required = createGuard({ ...options, mapClaims: () => ({ id: 'id' }) });
    const optional = createGuard({ ...options, mode: 'optional', mapClaims: () => ({ id: 'id' }) });
    const result = await optional.decide(request);
    expectTypeOf(result).toEqualTypeOf<Decision<{ id: string }, 'optional'>>();
    expectTypeOf<Awaited<ReturnType<typeof required.decide>>>().toEqualTypeOf<
      Decision<{ id: string }>
    >();
    if (result.kind === 'continue') {
      expectTypeOf(result.auth).toEqualTypeOf<Auth<{ id: string }> | null>();
    }

    // @ts-expect-error an existing verifier cannot be combined with verifier configuration
    const bad: IntegrationOptions<{ id: string }> = {
      verifier: verifier(),
      issuer: options.issuer,
    };
    expect(() => createGuard(bad)).toThrow(ConfigurationError);
  });
  it('creates once and owns scopes across requests', async () => {
    const existing = verifier();
    const scopes = ['read'];
    const guard = createGuard({ verifier: existing, scopes });
    scopes.push('admin');
    expect(guard.verifier).toBe(existing);
    for (let index = 0; index < 3; index++) {
      expect((await guard.decide({ ...request, authorization: ['Bearer a.b.c'] })).kind).toBe(
        'continue',
      );
    }

    expect(existing.verify).toHaveBeenCalledTimes(3);
    const created = createGuard(options);
    expect(created.verifier).toBe(created.verifier);
  });
  it.each([
    null,
    { ...options, mode: 'bad' },
    { ...options, scopeMode: 'bad' },
    { ...options, skip: 1 },
    { ...options, onIntegrationDiagnostic: 1 },
    { ...options, scopes: [] },
    { verifier: null },
    { verifier: {} },
    { verifier: { verify: () => {} } },
    { verifier: { verify: () => {}, warmup: () => {} } },
    { verifier: { verify: () => {}, warmup: () => {}, issuer: '' } },
    { verifier: undefined },
  ])('validates factory policy %j', (value) => {
    expect(() => createGuard(value as IntegrationOptions)).toThrow(ConfigurationError);
  });
  it.each(['issuer', 'audience', 'algorithms', 'keys', 'fetch', 'onDiagnostic', 'clock'] as const)(
    'rejects existing verifier plus %s even undefined',
    (key) => {
      expect(() =>
        createGuard({ verifier: verifier(), [key]: undefined } as unknown as IntegrationOptions),
      ).toThrow(ConfigurationError);
    },
  );
  it('rejects bad scopes and translates unexpected trusted failures safely', async () => {
    expect(() => createGuard({ ...options, scopes: ['bad scope'] })).toThrow(ConfigurationError);
    const guard = createGuard({
      verifier: {
        ...verifier(),
        verify: async () => {
          throw 'secret';
        },
      },
    });
    const result = await guard.decide({ ...request, authorization: ['Bearer a.b.c'] });
    expect(result.kind).toBe('reject');
    if (result.kind !== 'reject') {
      throw new Error('Expected rejection');
    }

    expect(result.error.reason).toBe('adapter_misconfigured');
    expect(await toResponse(result.http).text()).not.toContain('secret');

    const skipped = createGuard({
      ...options,
      skip: () => {
        throw null;
      },
    });
    expect((await skipped.decide(request)).kind).toBe('reject');
  });
  it('uses the explicit default realm for pre-verification failures with an existing verifier', async () => {
    const existing = createJwtVerifier({ ...options, realm: 'private-verifier-realm' });
    const guard = createGuard({ verifier: existing });
    const result = await guard.decide(request);
    if (result.kind !== 'reject') {
      throw new Error('Expected rejection');
    }

    expect(result.http.headers['www-authenticate']).toBe('Bearer realm="api"');
  });
  it('retains configured realm and validates scope mode without scopes', async () => {
    const result = await createGuard({ ...options, realm: 'custom' }).decide(request);
    if (result.kind !== 'reject') {
      throw new Error('Expected rejection');
    }

    expect(result.http.headers['www-authenticate']).toBe('Bearer realm="custom"');
  });
  it.each(['throw', 'reject', 'none', 'success'] as const)(
    'isolates adapter diagnostic %s in existing-verifier mode',
    async (behavior) => {
      const events: unknown[] = [];
      const callback = (event: unknown): unknown => {
        events.push(event);
        if (behavior === 'throw') {
          throw null;
        }

        if (behavior === 'reject') {
          return Promise.reject('secret');
        }

        return 1;
      };
      const guard = createGuard({
        verifier: verifier(),
        ...(behavior === 'none' ? {} : { onIntegrationDiagnostic: callback }),
      });
      expect(() => guard.reportErrorHookFailure()).not.toThrow();
      await Promise.resolve();
      expect(events).toEqual(behavior === 'none' ? [] : [{ type: 'integration.on_error_failed' }]);
    },
  );
  it('cleans caller listeners for success, rejection and abort even for a verifier ignoring cancellation', async () => {
    for (const path of ['success', 'reject', 'abort'] as const) {
      const controller = new AbortController();
      const existing = verifier();
      const guard = createGuard({
        verifier: {
          ...existing,
          verify: path === 'abort' ? () => new Promise<never>(() => {}) : existing.verify,
        },
      });
      const pending = guard.decide(
        path === 'reject' ? request : { ...request, authorization: ['Bearer a.b.c'] },
        controller.signal,
      );
      if (path === 'abort') {
        controller.abort();
      }

      const result = await pending;
      expect(
        path !== 'abort' || (result.kind === 'reject' && result.error.reason === 'request_aborted'),
      ).toBe(true);

      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    }

    const aborted = await createGuard(options).decide(request, AbortSignal.abort());
    expect(aborted.kind === 'reject' && aborted.error.reason).toBe('request_aborted');
  });
});

describe('transport extraction', () => {
  it('keeps Fetch comma joins and distinguishes absence', () => {
    expect(authorizationFromHeaders(new Headers())).toEqual([]);
    expect(
      authorizationFromHeaders(
        new Headers([
          ['authorization', 'Bearer a'],
          ['Authorization', 'Bearer b'],
        ]),
      ),
    ).toEqual(['Bearer a, Bearer b']);
  });
  it('prefers distinct headers, scans raw headers case insensitively and never trusts normalized headers', () => {
    expect(
      authorizationFromNodeRequest({
        headersDistinct: { Authorization: ['a', 'b'], Other: ['x'], authorization: undefined },
        rawHeaders: ['authorization', 'ignored'],
      }),
    ).toEqual(['a', 'b']);
    expect(
      authorizationFromNodeRequest({
        rawHeaders: ['other', 'x', 'AUTHORIZATION', 'a', 'authorization', 'b', 'authorization'],
      }),
    ).toEqual(['a', 'b', '']);
    expect(authorizationFromNodeRequest({})).toEqual([]);
  });
  it('uses each Lambda ingress contract including case variants and authoritative empty multi-value maps', () => {
    const event = {
      headers: { Authorization: 'last', other: 'x', authorization: undefined },
      multiValueHeaders: { AUTHORIZATION: ['a', 'b'], other: ['x'], authorization: undefined },
    };
    expect(authorizationFromLambdaEvent(event, 'apiGatewayV1')).toEqual(['a', 'b']);
    expect(authorizationFromLambdaEvent(event, 'albMultiValue')).toEqual(['a', 'b']);
    expect(authorizationFromLambdaEvent(event, 'apiGatewayV2')).toEqual(['last']);
    expect(authorizationFromLambdaEvent(event, 'albSingleValue')).toEqual(['last']);
    expect(
      authorizationFromLambdaEvent({ headers: { authorization: 'joined,values' } }, 'apiGatewayV2'),
    ).toEqual(['joined,values']);
    expect(
      authorizationFromLambdaEvent({ headers: { authorization: 'fallback' } }, 'apiGatewayV1'),
    ).toEqual(['fallback']);
    expect(
      authorizationFromLambdaEvent(
        { headers: { authorization: 'ignored' }, multiValueHeaders: {} },
        'apiGatewayV1',
      ),
    ).toEqual([]);
    expect(authorizationFromLambdaEvent({}, 'apiGatewayV2')).toEqual([]);
    expect(() => authorizationFromLambdaEvent({}, 'albMultiValue')).toThrow(JwtVerifierError);
  });
});

it('reports fixed frozen configuration diagnostics independently of supplied-verifier observers', async () => {
  const verifier = createJwtVerifier({ issuer: 'https://issuer.example', audience: 'api' });
  const events: unknown[] = [];
  const guard = createGuard({
    verifier,
    onIntegrationDiagnostic: (event) => {
      expect(Object.isFrozen(event)).toBe(true);
      events.push(event);
    },
  });
  guard.reportMisconfiguration();
  guard.reportErrorHookFailure();
  expect(events).toEqual([
    { type: 'integration.adapter_misconfigured' },
    { type: 'integration.on_error_failed' },
  ]);
  for (const observer of [
    () => {
      throw null;
    },
    () => Promise.reject('private'),
    () =>
      // oxlint-disable-next-line unicorn/no-thenable -- Explicit hostile thenable verifies rejection isolation without awaiting it.
      Object.defineProperty({}, 'then', {
        value: (_resolve: unknown, reject: (reason: unknown) => void) => reject('private'),
      }),
  ]) {
    const isolated = createGuard({ verifier, onIntegrationDiagnostic: observer });
    expect(() => isolated.reportMisconfiguration()).not.toThrow();
    await Promise.resolve();
  }

  expect(() => createGuard({ verifier }).reportMisconfiguration()).not.toThrow();
});
