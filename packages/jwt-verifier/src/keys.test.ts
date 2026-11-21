import type { JWK } from 'jose';

import fc from 'fast-check';
import { exportJWK, generateKeyPair } from 'jose';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vite-plus/test';

import type { Algorithm } from './options.ts';

import { fixtureKey } from '../../testkit/src/keys.ts';
import { Discovery } from './discovery.ts';
import { FetchState } from './fetch-state.ts';
import { importKeySet } from './jwks/import.ts';
import { KeyStore } from './jwks/store.ts';
import { validateOptions } from './options.ts';

const jwk = fixtureKey(2048).jwk;
const base = { issuer: 'https://issuer.test', audience: 'api', jwksUri: 'https://keys.test' };
const runs = process.env.NIGHTLY ? 100_000 : 1_000;

test('imports all supported public key families and rejects private, weak and ineligible metadata', async () => {
  const diagnostic = vi.fn();
  const options = validateOptions({
    ...base,
    algorithms: ['RS256', 'PS256', 'ES256', 'ES384', 'ES512', 'EdDSA', 'Ed25519'],
    onDiagnostic: diagnostic,
  });
  const valid: JWK[] = [jwk];
  for (const alg of ['ES256', 'ES384', 'ES512', 'EdDSA'] as Algorithm[]) {
    const pair = await generateKeyPair(alg);
    valid.push(await exportJWK(pair.publicKey));
  }

  const invalid = [
    null,
    1,
    [],
    { kty: 'oct', k: 'secret' },
    { ...jwk, use: 'enc' },
    { ...jwk, key_ops: ['sign'] },
    { ...jwk, key_ops: 'verify' },
    { ...jwk, alg: 'HS256' },
    { ...jwk, kid: 2 },
    fixtureKey(1024).jwk,
    { ...jwk, n: '!!!' },
    { ...jwk, n: 'AA' },
    { ...jwk, n: undefined, x5c: undefined },
    { kty: 'EC', crv: 'P-999', x: 'a', y: 'a' },
    { kty: 'OKP', crv: 'X25519', x: 'a' },
    { kty: 'RSA', n: 'AQAB', e: 'AQAB' },
    ...['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].map((key) => ({ ...jwk, [key]: 'private' })),
  ];
  const result = await importKeySet({ keys: [...valid, ...invalid] }, options, 'https://keys.test');
  expect(result.keys).toHaveLength(valid.length);
  expect(diagnostic.mock.calls.filter(([event]) => event.type === 'jwks.key_skipped')).toHaveLength(
    invalid.length,
  );
  expect(
    (
      await importKeySet(
        { keys: [{ ...jwk, key_ops: ['verify'], use: 'sig', alg: 'RS256' }] },
        options,
        'url',
      )
    ).keys,
  ).toHaveLength(1);
  for (const raw of [null, [], {}, { keys: 1 }, { keys: Array.from({ length: 101 }, () => jwk) }]) {
    await expect(importKeySet(raw, options, 'url')).rejects.toMatchObject({
      reason: 'jwks_invalid',
    });
  }

  const normalized = { ...jwk, n: 'AA' + jwk.n };
  expect((await importKeySet({ keys: [normalized] }, options, 'url')).keys).toHaveLength(1);
});

test('x5c converts a public key without validating the certificate chain and skips bad entries individually', async () => {
  const diagnostic = vi.fn();
  const options = validateOptions({ ...base, onDiagnostic: diagnostic });
  const cert = readFileSync(
    new URL('../../testkit/fixtures/rsa-2048.crt', import.meta.url),
    'utf8',
  ).replace(/-----[^\n]+-----|\s/g, '');
  expect(
    (
      await importKeySet(
        {
          keys: [
            {
              kty: 'RSA',
              kid: 'certificate',
              use: 'sig',
              alg: 'RS256',
              key_ops: ['verify'],
              x5c: [cert],
            },
          ],
        },
        options,
        'url',
      )
    ).keys[0],
  ).toMatchObject({
    kty: 'RSA',
    kid: 'certificate',
    use: 'sig',
    alg: 'RS256',
    key_ops: ['verify'],
  });
  for (const entry of [
    { kty: 'RSA', x5c: [42] },
    { kty: 'RSA', x5c: ['!!!!'] },
    { kty: 'RSA', x5c: ['AAAA'] },
    { kty: 'EC', x5c: [cert] },
    { kty: 'RSA', x5c: [] },
    { kty: 'RSA', x5c: [cert], kid: 'a\nb' },
  ]) {
    const imported = await importKeySet({ keys: [entry, jwk] }, options, 'url');
    expect(imported.keys.length).toBeGreaterThanOrEqual(1);
  }

  const unsupported = validateOptions({ ...base, algorithms: ['EdDSA'] });
  expect(
    (await importKeySet({ keys: [{ kty: 'RSA', x5c: [cert] }] }, unsupported, 'url')).keys,
  ).toEqual([]);
});

test('store obeys cooldown, refresh replacement, fail-closed stale default and explicit stale outage bound', async () => {
  let now = 0;
  let failed = false;
  let current = { ...jwk, kid: 'old' };
  const diagnostic = vi.fn();
  const fetcher = vi.fn(async () => {
    if (failed) {
      throw new Error('outage');
    }

    return Response.json({ keys: [current] });
  });
  const options = validateOptions({
    ...base,
    clock: { now: () => now },
    fetch: fetcher,
    onDiagnostic: diagnostic,
    keys: { cacheMaxAge: 10, cooldown: 3, staleIfError: 2 },
  });
  const store = new KeyStore(options, 'https://keys.test');
  await store.warmup();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(store.get({ alg: 'RS256', kid: 'missing' })).rejects.toMatchObject({
    reason: 'key_not_found',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  now = 3001;
  current = { ...jwk, kid: 'new' };
  await store.get({ alg: 'RS256', kid: 'new' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(store.get({ alg: 'RS256', kid: 'old' })).rejects.toMatchObject({
    reason: 'key_not_found',
  });
  failed = true;
  now = 13002;
  await store.get({ alg: 'RS256', kid: 'new' });
  expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({ type: 'jwks.stale_served' }));
  now = 15002;
  await expect(store.get({ alg: 'RS256', kid: 'new' })).rejects.toMatchObject({
    reason: 'jwks_unavailable',
  });
  const closed = new KeyStore(
    validateOptions({
      ...base,
      clock: { now: () => now },
      fetch: fetcher,
      keys: { cacheMaxAge: 0 },
    }),
    'url',
  );
  await expect(closed.warmup()).rejects.toMatchObject({ reason: 'jwks_unavailable' });
});

test('duplicate eligible kids stay ambiguous in both selection passes and unknown refresh reports missing', async () => {
  let now = 0;
  let keys = [jwk];
  const options = validateOptions({
    ...base,
    clock: { now: () => now },
    fetch: async () => Response.json({ keys }),
    keys: { cooldown: 1 },
  });
  const store = new KeyStore(options, 'url');
  await store.warmup();
  now = 1001;
  keys = [jwk, jwk];
  await expect(store.get({ alg: 'RS256', kid: 'unknown' })).rejects.toMatchObject({
    reason: 'key_not_found',
  });
  await expect(store.get({ alg: 'RS256', kid: jwk.kid as string })).rejects.toMatchObject({
    reason: 'jwks_invalid',
  });
  const second = new KeyStore(options, 'url');
  await second.warmup();
  now = 2002;
  keys = [
    { ...jwk, kid: 'unknown' },
    { ...jwk, kid: 'unknown' },
  ];
  await expect(second.get({ alg: 'RS256', kid: 'unknown' })).rejects.toMatchObject({
    reason: 'jwks_invalid',
  });
});

test('shared fetch joins one promise; nonsharing cold requests cap concurrency and newer generations win', async () => {
  const deferred = (): {
    promise: Promise<string>;
    resolve: (value: string) => void;
    reject: (value: unknown) => void;
  } => {
    let resolve: (value: string) => void = () => {};
    let reject: (value: unknown) => void = () => {};
    const promise = new Promise<string>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    return { promise, resolve, reject };
  };
  let now = 1;
  const options = validateOptions({ ...base, clock: { now: () => now } });
  const shared = new FetchState<string>(options, 'jwks');
  const first = deferred();
  const action = vi.fn(() => first.promise);
  const a = shared.load(action);
  const b = shared.load(action);
  expect(a).toBe(b);
  first.resolve('value');
  await a;
  expect(action).toHaveBeenCalledTimes(1);
  const nonsharing = new FetchState<string>(
    validateOptions({
      ...base,
      shareInflight: false,
      clock: { now: () => now },
      keys: { maxConcurrentFetches: 2 },
    }),
    'jwks',
  );
  const old = deferred();
  const fresh = deferred();
  const pOld = nonsharing.load(() => old.promise);
  const pNew = nonsharing.load(() => fresh.promise);
  await expect(nonsharing.load(async () => 'third')).rejects.toMatchObject({
    reason: 'jwks_unavailable',
  });
  now = 2;
  fresh.resolve('new');
  await pNew;
  now = 3;
  old.resolve('old');
  expect(await pOld).toBe('new');
  expect(nonsharing.value).toBe('new');
  expect(nonsharing.fetchedAt).toBe(2);
  const pending = deferred();
  const p = nonsharing.load(() => pending.promise);
  await expect(nonsharing.load(async () => 'x', true)).rejects.toMatchObject({
    reason: 'key_not_found',
  });
  await expect(nonsharing.load(async () => 'x')).rejects.toMatchObject({
    reason: 'jwks_unavailable',
  });
  pending.reject(new Error('outage'));
  await expect(p).rejects.toThrow('outage');
  expect(nonsharing.fetchedAt).toBe(2);
  vi.spyOn(Math, 'random').mockReturnValue(1);
  const state = new FetchState<string>(options, 'discovery');
  for (let failure = 0; failure < 8; failure++) {
    now += 31_000;
    await expect(
      state.load(async () => {
        throw 'outage';
      }),
    ).rejects.toBe('outage');
    expect(state.backoffUntil - now).toBe(Math.min(30_000, 1000 * 2 ** failure));
  }

  await expect(state.load(async () => 'blocked')).rejects.toMatchObject({
    reason: 'discovery_unavailable',
  });
});

test('older failed response cannot impose backoff over newer successful generation', async () => {
  let reject: (error: unknown) => void = () => {};
  const old = new Promise<string>((_, fail) => {
    reject = fail;
  });
  const state = new FetchState<string>(validateOptions({ ...base, shareInflight: false }), 'jwks');
  const pending = state.load(() => old);
  await state.load(async () => 'new');
  reject('old outage');
  await expect(pending).rejects.toBe('old outage');
  expect(state.backoffUntil).toBe(-Infinity);
});

test('discovery validates metadata, exact issuer and endpoints and caches for exactly 24 hours', async () => {
  let now = 0;
  let endpoint = 'https://other.test/keys';
  const fetcher = vi.fn(async () => Response.json({ issuer: base.issuer, jwks_uri: endpoint }));
  const discovery = new Discovery(
    validateOptions({ ...base, discovery: 'oauth', clock: { now: () => now }, fetch: fetcher }),
  );
  expect(await discovery.get()).toBe(endpoint);
  now = 86_400_000 - 1;
  await discovery.get();
  expect(fetcher).toHaveBeenCalledTimes(1);
  now++;
  endpoint = 'https://new.test';
  expect(await discovery.get()).toBe(endpoint);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const value of [
    null,
    [],
    {},
    { issuer: 'wrong', jwks_uri: endpoint },
    { issuer: base.issuer, jwks_uri: 'http://wrong.test' },
    { issuer: base.issuer, jwks_uri: 'https://user:pass@other.test' },
    { issuer: base.issuer, jwks_uri: 'https://other.test/#bad' },
  ]) {
    await expect(
      new Discovery(validateOptions({ ...base, fetch: async () => Response.json(value) })).get(),
    ).rejects.toMatchObject({ reason: 'discovery_invalid' });
  }

  const oauth = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ issuer: 'https://issuer.test/path', jwks_uri: endpoint }),
  );
  await new Discovery(
    validateOptions({
      ...base,
      issuer: 'https://issuer.test/path',
      discovery: 'oauth',
      fetch: oauth,
    }),
  )
    .get()
    .catch(() => {});
  expect(oauth.mock.calls[0]?.[0]).toBe(
    'https://issuer.test/.well-known/oauth-authorization-server/path',
  );
  const oidc = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ issuer: 'https://issuer.test/', jwks_uri: endpoint }),
  );
  await new Discovery(validateOptions({ ...base, issuer: 'https://issuer.test/', fetch: oidc }))
    .get()
    .catch(() => {});
  expect(oidc.mock.calls[0]?.[0]).toBe('https://issuer.test/.well-known/openid-configuration');
});

interface Model {
  now: number;
  success: boolean;
  advertised: string;
  cached: string | undefined;
  fetchedAt: number;
  lastAttempt: number;
  backoffUntil: number;
  failures: number;
  fetches: number;
}
interface Real {
  readonly store: KeyStore;
  readonly state: Model;
  readonly fetcher: ReturnType<typeof vi.fn>;
}
class KeyCommand implements fc.AsyncCommand<Model, Real> {
  readonly kind: 'tick' | 'fetch ok' | 'fetch fail' | 'rotate' | 'unknown kid' | 'request';
  constructor(kind: KeyCommand['kind']) {
    this.kind = kind;
  }

  check(): boolean {
    return true;
  }
  async run(model: Model, real: Real): Promise<void> {
    if (this.kind === 'tick') {
      model.now += 1500;
      real.state.now = model.now;
      return;
    }

    if (this.kind === 'fetch ok' || this.kind === 'fetch fail') {
      model.success = this.kind === 'fetch ok';
      real.state.success = model.success;
      return;
    }

    if (this.kind === 'rotate') {
      model.advertised = model.advertised === 'a' ? 'b' : 'a';
      real.state.advertised = model.advertised;
      return;
    }

    const requested = this.kind === 'unknown kid' ? 'unknown' : model.advertised;
    const fresh = model.cached !== undefined && model.now < model.fetchedAt + 2000;
    let shouldFetch = !fresh;
    if (fresh && requested !== model.cached && model.now - model.lastAttempt >= 1000) {
      shouldFetch = true;
    }

    if (model.now < model.backoffUntil) {
      shouldFetch = false;
    }

    if (shouldFetch) {
      model.fetches++;
      model.lastAttempt = model.now;
      if (model.success) {
        model.cached = model.advertised;
        model.fetchedAt = model.now;
        model.failures = 0;
        model.backoffUntil = -Infinity;
      } else {
        model.failures++;
        model.backoffUntil =
          model.now + Math.min(30000, 1000 * 2 ** Math.min(5, model.failures - 1));
      }
    }

    const available = model.cached !== undefined && model.now < model.fetchedAt + 2000;
    const accepted = available && requested === model.cached;
    let actual = false;
    try {
      await real.store.get({ alg: 'RS256', kid: requested });
      actual = true;
    } catch {}

    assert.equal(actual, accepted);
    assert.equal(real.fetcher.mock.calls.length, model.fetches);
  }
  toString(): string {
    return this.kind;
  }
}

test(
  'model commands cover tick, fetch ok/fail, rotate, unknown kid and request against the cache policy',
  async () => {
    expect(runs).toBe(process.env.NIGHTLY ? 100_000 : 1_000);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const command = fc
      .constantFrom('tick', 'fetch ok', 'fetch fail', 'rotate', 'unknown kid', 'request')
      .map((kind) => new KeyCommand(kind as KeyCommand['kind']));
    await fc.assert(
      fc.asyncProperty(fc.commands([command], { maxCommands: 20 }), async (commands) => {
        const initial = (): Model => ({
          now: 0,
          success: true,
          advertised: 'a',
          cached: undefined,
          fetchedAt: -Infinity,
          lastAttempt: -Infinity,
          backoffUntil: -Infinity,
          failures: 0,
          fetches: 0,
        });
        const state = initial();
        const fetcher = vi.fn(async () => {
          if (!state.success) {
            throw new Error('outage');
          }

          return Response.json({ keys: [{ ...jwk, kid: state.advertised }] });
        });
        const store = new KeyStore(
          validateOptions({
            ...base,
            clock: { now: () => state.now },
            fetch: fetcher,
            keys: { cacheMaxAge: 2, cooldown: 1 },
          }),
          'url',
        );
        await fc.asyncModelRun(
          () => ({ model: initial(), real: { store, state, fetcher } }),
          commands,
        );
      }),
      { numRuns: runs },
    );
  },
  process.env.NIGHTLY ? 600_000 : 30_000,
);

test('a failing older cold fetch can use a newer fresh cache without reporting stale use', async () => {
  let reject: (error: unknown) => void = () => {};
  const stalled = new Promise<Response>((_, failure) => {
    reject = failure;
  });
  const diagnostic = vi.fn();
  let count = 0;
  const store = new KeyStore(
    validateOptions({
      ...base,
      shareInflight: false,
      onDiagnostic: diagnostic,
      fetch: async () => {
        count++;
        return count === 1 ? stalled : Response.json({ keys: [jwk] });
      },
    }),
    'url',
  );
  const older = store.warmup();
  await store.warmup();
  reject(new Error('older failed'));
  await older;
  expect(diagnostic.mock.calls.some(([event]) => event.type === 'jwks.stale_served')).toBe(false);
  const cert = readFileSync(
    new URL('../../testkit/fixtures/rsa-2048.crt', import.meta.url),
    'utf8',
  ).replace(/-----[^\n]+-----|\s/g, '');
  expect(
    (await importKeySet({ keys: [{ kty: 'RSA', x5c: [cert] }] }, validateOptions(base), 'url'))
      .keys,
  ).toHaveLength(1);
});

test('key type and EC/OKP curve compatibility enforce the complete asymmetric matrix', async () => {
  const { compatible, modulusBits } = await import('./jwks/import.ts');
  for (const alg of ['RS256', 'PS256'] as Algorithm[]) {
    expect(compatible({ kty: 'RSA' }, alg)).toBe(true);
    expect(compatible({ kty: 'EC', crv: 'P-256' }, alg)).toBe(false);
  }

  for (const [alg, crv] of [
    ['ES256', 'P-256'],
    ['ES384', 'P-384'],
    ['ES512', 'P-521'],
  ] as const) {
    expect(compatible({ kty: 'EC', crv }, alg)).toBe(true);
    expect(compatible({ kty: 'EC', crv: 'P-999' }, alg)).toBe(false);
    expect(compatible({ kty: 'RSA', crv }, alg)).toBe(false);
  }

  for (const alg of ['EdDSA', 'Ed25519'] as const) {
    expect(compatible({ kty: 'OKP', crv: 'Ed25519' }, alg)).toBe(true);
    expect(compatible({ kty: 'OKP', crv: 'X25519' }, alg)).toBe(false);
    expect(compatible({ kty: 'EC', crv: 'Ed25519' }, alg)).toBe(false);
  }

  for (const [value, bits] of [
    ['AQ', 1],
    ['AAE', 1],
    ['gA', 8],
    ['AIA', 8],
    ['', 0],
    ['AA', 0],
    ['AAAA', 0],
    ['!AQ', 0],
    ['AQ!', 0],
    [undefined, 0],
    [1, 0],
  ] as const) {
    expect(modulusBits(value)).toBe(bits);
  }

  const boundary = Buffer.alloc(256, 255);
  boundary[0] = 127;
  expect(modulusBits(boundary.toString('base64url'))).toBe(2047);
  boundary[0] = 128;
  expect(modulusBits(boundary.toString('base64url'))).toBe(2048);
  const options = validateOptions({ ...base, keys: { maxKeys: 1 } });
  expect((await importKeySet({ keys: [jwk] }, options, 'url')).keys).toHaveLength(1);
  const events = vi.fn();
  await importKeySet(
    { keys: [{ ...jwk, d: 'secret', kid: 'bad\nkid' }, null] },
    validateOptions({ ...base, onDiagnostic: events }),
    'https://keys.test',
  );
  expect(events.mock.calls.map(([event]) => event)).toEqual([
    { type: 'jwks.key_skipped', url: 'https://keys.test', kid: 'bad?kid', problem: 'invalid_key' },
    { type: 'jwks.key_skipped', url: 'https://keys.test', problem: 'invalid_key' },
  ]);
});

test('freshness, stale allowance and unknown-kid cooldown use strict exact boundaries', async () => {
  let instant = 0;
  let fail = false;
  const fetcher = vi.fn(async () => {
    if (fail) {
      throw null;
    }

    return Response.json({ keys: [jwk] });
  });
  const options = validateOptions({
    ...base,
    clock: { now: () => instant },
    fetch: fetcher,
    keys: { cacheMaxAge: 2, cooldown: 1, staleIfError: 1 },
  });
  const store = new KeyStore(options, 'url');
  await store.warmup();
  instant = 1000;
  await expect(store.get({ alg: 'RS256', kid: 'missing' })).rejects.toMatchObject({
    reason: 'key_not_found',
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  instant = 3000;
  fail = true;
  await store.warmup();
  expect(fetcher).toHaveBeenCalledTimes(3);
  instant = 4000;
  await expect(store.warmup()).rejects.toMatchObject({ reason: 'jwks_unavailable' });
  const closed = new KeyStore(
    validateOptions({
      ...base,
      clock: { now: () => instant },
      fetch: fetcher,
      keys: { cacheMaxAge: 1, staleIfError: 0 },
    }),
    'url',
  );
  fail = false;
  await closed.warmup();
  instant = 5000;
  fail = true;
  await expect(closed.warmup()).rejects.toMatchObject({ reason: 'jwks_unavailable' });
});

test('x5c-only EC keys try allowed curves in order and reject explicit curve/family conflicts', async () => {
  const diagnostics = vi.fn();
  const options = validateOptions({
    ...base,
    algorithms: ['ES256', 'ES384', 'ES512'],
    onDiagnostic: diagnostics,
  });
  for (const [bits, curve, alg] of [
    [256, 'P-256', 'ES256'],
    [384, 'P-384', 'ES384'],
    [521, 'P-521', 'ES512'],
  ] as const) {
    const cert = readFileSync(
      new URL(`../../testkit/fixtures/ec-p${bits}.crt`, import.meta.url),
      'utf8',
    ).replace(/-----[^\n]+-----|\s/g, '');
    const entry = { kty: 'EC', kid: `ec-${bits}`, x5c: [cert] };
    const normalized = await importKeySet({ keys: [entry] }, options, 'url');
    expect(normalized.keys).toHaveLength(1);
    expect(normalized.keys[0]).toMatchObject({ kty: 'EC', kid: `ec-${bits}`, crv: curve });
    expect(
      (await importKeySet({ keys: [{ ...entry, alg }] }, options, 'url')).keys[0],
    ).toMatchObject({ kty: 'EC', crv: curve, alg });
    const wrong = alg === 'ES256' ? 'ES384' : 'ES256';
    expect((await importKeySet({ keys: [{ ...entry, alg: wrong }] }, options, 'url')).keys).toEqual(
      [],
    );
    expect(
      (await importKeySet({ keys: [{ ...entry, kty: 'RSA', alg }] }, options, 'url')).keys,
    ).toEqual([]);
  }

  expect(
    diagnostics.mock.calls.filter(([event]) => event.type === 'jwks.key_skipped'),
  ).toHaveLength(6);
});
