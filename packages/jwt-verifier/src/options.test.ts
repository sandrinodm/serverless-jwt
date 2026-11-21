import { expect, test, vi } from 'vite-plus/test';

import type { JwtVerifierOptions } from './options.ts';

import { ConfigurationError, JwtVerifierError, messages, quoteChallenge } from './errors.ts';
import { validateOptions, validEndpoint } from './options.ts';

const basic = { issuer: 'https://issuer.test', audience: 'api' };

test('retains the native global fetch receiver while preserving supplied fetch identity', async () => {
  const nativeFetch = vi.fn(function (this: unknown): Promise<Response> {
    expect(this).toBe(globalThis);
    return Promise.resolve(Response.json({ keys: [] }));
  });
  vi.stubGlobal('fetch', nativeFetch);
  const resolved = validateOptions(basic);
  await resolved.fetch('https://issuer.test/jwks');
  expect(nativeFetch).toHaveBeenCalledOnce();
  const supplied = vi.fn(async (): Promise<Response> => Response.json({ keys: [] }));
  expect(validateOptions({ ...basic, fetch: supplied }).fetch).toBe(supplied);
});

test('owns deeply immutable policy while retaining exact issuer and audience', () => {
  const source = {
    ...basic,
    audience: ['api'],
    algorithms: ['RS256'],
    keys: { cooldown: 30 },
    requiredClaims: ['sub'],
  };
  const resolved = validateOptions(source as JwtVerifierOptions);
  source.audience[0] = 'other';
  source.algorithms[0] = 'HS256';
  source.keys.cooldown = 0;
  source.requiredClaims[0] = 'other';
  expect(resolved.audience).toEqual(['api']);
  expect(resolved.algorithms).toEqual(['RS256']);
  expect(resolved.keys.cooldown).toBe(30);
  expect(resolved.requiredClaims).toContain('sub');
  expect(Object.isFrozen(resolved)).toBe(true);
  expect(Object.isFrozen(resolved.keys)).toBe(true);
  expect(resolved.mapClaims({ sub: 'x' })).toEqual({ sub: 'x' });
  expect(resolved.clock.now()).toBeGreaterThan(0);
});

test.each([
  null,
  undefined,
  false,
  { ...basic, issuer: '' },
  { ...basic, issuer: 'http://example.com' },
  { ...basic, audience: '' },
  { ...basic, audience: [] },
  { ...basic, audience: [''] },
  { ...basic, audience: [1] },
  { ...basic, algorithms: [] },
  { ...basic, algorithms: ['HS256'] },
  { ...basic, jwksUri: 'http://example.com' },
  { ...basic, discovery: false },
  { ...basic, discovery: 'wrong' },
  { ...basic, profile: 'wrong' },
  { ...basic, profile: 'rfc9068', requireExp: false },
  { ...basic, requireExp: 0 },
  { ...basic, allowInsecureLocalhost: 0 },
  { ...basic, shareInflight: 0 },
  { ...basic, requiredClaims: [1] },
  { ...basic, requiredClaims: '' },
  { ...basic, fetch: 0 },
  { ...basic, mapClaims: 0 },
  { ...basic, onDiagnostic: 0 },
  { ...basic, clock: null },
  { ...basic, clock: {} },
  { ...basic, keys: null },
  { ...basic, realm: 'bad\n' },
])('rejects invalid configuration %#', (value) => {
  expect(() => validateOptions(value as JwtVerifierOptions)).toThrow(ConfigurationError);
});

test.each([
  'verifyTimeout',
  'clockTolerance',
  'maxTokenAge',
  'maxTokenLength',
  'minRsaModulusLength',
])('validates numeric bound %s', (key) => {
  for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => validateOptions({ ...basic, [key]: value })).toThrow(ConfigurationError);
  }
});

test.each([
  'cacheMaxAge',
  'cooldown',
  'timeout',
  'maxResponseBytes',
  'maxKeys',
  'staleIfError',
  'maxConcurrentFetches',
])('validates key bound %s', (key) => {
  expect(() => validateOptions({ ...basic, keys: { [key]: -1 } })).toThrow(ConfigurationError);
});

test('supports direct opaque issuers, configured extensions and RFC9068 required claims', () => {
  const now = (): number => 123;
  const mapClaims = (): object => ({});
  const observer = (): void => {};
  const resolved = validateOptions({
    ...basic,
    issuer: 'opaque issuer',
    jwksUri: 'https://keys.test',
    discovery: false,
    profile: 'rfc9068',
    maxTokenAge: 42,
    clock: { now },
    mapClaims,
    onDiagnostic: observer,
    shareInflight: false,
    realm: 'my api',
  });
  expect(resolved.requiredClaims).toEqual(
    expect.arrayContaining(['iss', 'aud', 'exp', 'iat', 'sub', 'client_id', 'jti']),
  );
  expect(resolved.maxTokenAge).toBe(42);
  expect(resolved.clock.now()).toBe(123);
  expect(resolved.mapClaims).toBe(mapClaims);
  expect(resolved.onDiagnostic).toBe(observer);
  expect(validateOptions({ ...basic, requireExp: false }).requiredClaims).not.toContain('exp');
});

test.each([
  ['https://example.com', false, true],
  ['http://localhost:1', true, true],
  ['http://127.0.0.1', true, true],
  ['http://[::1]', true, true],
  ['http://localhost', false, false],
  ['http://evil.test', true, false],
  ['https://u:p@example.com', false, false],
  ['https://example.com/#bad', false, false],
  ['not a URL', false, false],
  ['', false, false],
  [null, false, false],
])('checks endpoint trust %#', (value, local, expected) => {
  expect(validEndpoint(value, local as boolean)).toBe(expected);
});

test('every failure uses the fixed message table and excludes causes from JSON/HTTP', () => {
  for (const reason of Object.keys(messages) as (keyof typeof messages)[]) {
    const error = new JwtVerifierError(reason, {
      cause: 'INJECTED_SECRET',
      realm: 'my"realm\\',
      retryAfter: 2.5,
      scopes: ['read', 'write'],
    });
    expect(error.message).toBe(messages[reason]);
    expect(Object.keys(error)).not.toContain('cause');
    expect(JSON.stringify(error)).not.toContain('INJECTED_SECRET');
    const http = error.toHttp();
    expect(http.body).toEqual(error.toJSON());
    expect(http.status).toBe(error.status);
    expect(http.headers['content-type']).toBe('application/json');
    expect(http.headers['cache-control']).toBe('no-store');
    const challenge = {
      missing_token: 'Bearer realm="my\\\"realm\\\\"',
      invalid_request: 'Bearer error="invalid_request"',
      invalid_token: `Bearer error="invalid_token", error_description="${error.message}"`,
      insufficient_scope: 'Bearer error="insufficient_scope", scope="read write"',
      temporarily_unavailable: undefined,
      server_error: undefined,
    }[error.code];
    expect(http.headers['www-authenticate']).toBe(challenge);
    expect(http.headers['retry-after']).toBe(
      error.code === 'temporarily_unavailable' ? '3' : undefined,
    );
  }

  expect(new JwtVerifierError('missing_token').toHttp().headers['www-authenticate']).toBe(
    'Bearer realm="api"',
  );
  expect(new JwtVerifierError('insufficient_scope').toHttp().headers['www-authenticate']).toContain(
    'scope=""',
  );
  expect(() =>
    new JwtVerifierError('insufficient_scope', { scopes: ['bad scope'] }).toHttp(),
  ).toThrow(ConfigurationError);
  for (const retryAfter of [undefined, NaN, Infinity, 0, 100]) {
    const options = retryAfter === undefined ? {} : { retryAfter };
    expect(new JwtVerifierError('jwks_unavailable', options).toHttp().headers['retry-after']).toBe(
      retryAfter === 100 ? '30' : '1',
    );
  }

  expect(() => quoteChallenge(null as unknown as string)).toThrow(ConfigurationError);
});

test('each configuration getter is captured once before resolving the immutable policy', () => {
  let ageReads = 0;
  let clockReads = 0;
  const options = {
    ...basic,
    get maxTokenAge() {
      ageReads++;
      return 10;
    },
    clock: {
      get now() {
        clockReads++;
        return (): number => 123;
      },
    },
  };
  expect(validateOptions(options).maxTokenAge).toBe(10);
  expect(ageReads).toBe(1);
  expect(clockReads).toBe(1);
});
