import fc from 'fast-check';
import { expect, test, vi } from 'vite-plus/test';

import type { Auth } from './verify.ts';

import { getBearerToken } from './bearer.ts';
import { safeClaims, removeNamespaces, claimToArray } from './claims.ts';
import { emit, safeKid } from './diagnostics.ts';
import { ConfigurationError, JwtVerifierError } from './errors.ts';
import { hasScopes, requireScopes } from './index.ts';
import { canShareInflight } from './runtime.ts';
import { scopesFromClaims } from './scopes.ts';
import { assertTokenShape } from './token-shape.ts';

const runs = process.env.NIGHTLY ? 100_000 : 1_000;

test.each([null, undefined, '', [], ' ', 'Basic abc'])('missing bearer %#', (input) => {
  expect(getBearerToken(input)).toEqual({ ok: false, reason: 'missing_token' });
});
test.each([
  'Bearer',
  'Bearer ',
  'Bearer a b',
  'Bearer a\n',
  'Bearer\tabc',
  'Bearer a\0',
  'Bearer a\x7f',
])('malformed bearer %#', (input) => {
  expect(getBearerToken(input)).toEqual({ ok: false, reason: 'malformed_header' });
});
test.each(['Bearer a, Bearer b', ['Bearer a', 'Bearer b']])('multiple credentials %#', (input) => {
  expect(getBearerToken(input)).toEqual({ ok: false, reason: 'multiple_credentials' });
});
test.each(['Bearer a', 'bearer  a', '  BEARER a  ', ['Bearer a']])('valid bearer %#', (input) => {
  expect(getBearerToken(input)).toEqual({ ok: true, token: 'a' });
});
test('header properties never throw and reject all embedded controls', () => {
  fc.assert(
    fc.property(fc.string(), (header) => {
      expect(() => getBearerToken(header)).not.toThrow();
    }),
    { numRuns: runs },
  );
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 31 }), fc.string(), (control, suffix) => {
      expect(getBearerToken(`Bearer a${String.fromCharCode(control)}${suffix}`).ok).toBe(false);
    }),
    { numRuns: runs },
  );
});

test('shape rejects before decode and accepts compact base64url alphabet', () => {
  for (const token of [null, undefined, 1, 'a.b', 'a.b.c.d.e', 'a.b.', 'a.b.=', 'a.!.c']) {
    expect(() => assertTokenShape(token as string, 8192)).toThrow(JwtVerifierError);
  }

  expect(() => assertTokenShape('x'.repeat(8193), 8192)).toThrow(
    expect.objectContaining({ reason: 'token_too_large' }),
  );
  expect(() => assertTokenShape('a.b.c', 5)).not.toThrow();
});

test('safe claims freezes nested JSON objects and arrays and drops pollution keys', () => {
  const claims = safeClaims(
    '{"__proto__":{},"constructor":{},"prototype":{},"nested":{"a":1,"__proto__":{}},"list":[{"a":2}],"nil":null}',
  );
  expect(Object.getPrototypeOf(claims)).toBeNull();
  expect(Object.getPrototypeOf(claims.nested)).toBeNull();
  expect(Object.isFrozen(claims)).toBe(true);
  expect(Object.isFrozen(claims.list)).toBe(true);
  expect(Object.isFrozen((claims.list as object[])[0])).toBe(true);
  expect(Object.keys(claims)).toEqual(['nested', 'list', 'nil']);
});

test('namespace collision is order independent and only leading namespace is removed', () => {
  for (const claims of [
    { sub: 'x', 'ns:sub': 'y' },
    { 'ns:sub': 'y', sub: 'x' },
  ]) {
    expect(() => removeNamespaces(claims, 'ns:')).toThrow(
      expect.objectContaining({ reason: 'namespace_collision' }),
    );
  }

  expect(
    removeNamespaces(
      { 'xns:a': 1, 'ns:b': 2, 'ns:__proto__': 3, 'ns:constructor': 4, 'ns:prototype': 5 },
      'ns:',
    ),
  ).toEqual({ 'xns:a': 1, b: 2 });
  fc.assert(
    fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (claims) => {
      expect(Object.getPrototypeOf(removeNamespaces(claims, 'prefix:'))).toBeNull();
    }),
    { numRuns: runs },
  );
});

test('claim arrays preserve string arrays without coercing nonstrings', () => {
  const values = ['a', 'b'];
  expect(claimToArray(values)).toBe(values);
  expect(claimToArray('a b')).toEqual(values);
  for (const value of [null, undefined, 0, {}, ['a', 1]]) {
    expect(claimToArray(value)).toEqual([]);
  }
});

test('scope precedence, Entra string scp and provider array form derive frozen deduplicated scopes', () => {
  const diagnostics = vi.fn();
  expect(scopesFromClaims({ scope: 'read read write', scp: 'other' }, diagnostics)).toEqual([
    'read',
    'write',
  ]);
  expect(diagnostics).toHaveBeenCalledWith({ type: 'claims.scope_and_scp' });
  expect(scopesFromClaims({ scp: 'read write' })).toEqual(['read', 'write']);
  expect(scopesFromClaims({ scp: ['read', 'write'] })).toEqual(['read', 'write']);
  for (const claims of [
    {},
    { scope: undefined },
    { scope: [] },
    { scope: 1 },
    { scp: 1 },
    { scp: ['read', 1] },
  ]) {
    expect(scopesFromClaims(claims, diagnostics)).toEqual([]);
  }

  expect(scopesFromClaims({ scope: 'read  bad" \\ wrong\n ok' })).toEqual(['read', 'ok']);
  expect(Object.isFrozen(scopesFromClaims({}))).toBe(true);
  const auth: Auth = { token: 'token', claims: {}, identity: {}, scopes: ['read'] };
  expect(hasScopes(auth, ['read'])).toBe(true);
  expect(hasScopes(auth, ['read', 'write'])).toBe(false);
  expect(hasScopes(auth, ['read', 'write'], 'any')).toBe(true);
  expect(hasScopes(auth, ['write'], 'any')).toBe(false);
  expect(() => requireScopes(auth, ['read'])).not.toThrow();
  expect(() => requireScopes(auth, ['write'])).toThrow(
    expect.objectContaining({ reason: 'insufficient_scope' }),
  );
  for (const required of [[], [''], ['bad scope'], [1]]) {
    expect(() => requireScopes(auth, required as string[])).toThrow(ConfigurationError);
  }

  expect(() => hasScopes(auth, ['read'], 'wrong' as 'all')).toThrow(ConfigurationError);
});

test('public scope helpers reject sparse requirements in both modes', () => {
  const auth: Auth = { token: 'token', claims: {}, identity: {}, scopes: ['read'] };
  const sparse: string[] = [];
  sparse.length = 2;
  const partlySparse = ['read'];
  partlySparse.length = 2;
  for (const required of [sparse, partlySparse]) {
    for (const mode of ['all', 'any'] as const) {
      for (const check of [hasScopes, requireScopes]) {
        expect(() => check(auth, required, mode)).toThrow(
          expect.objectContaining({ reason: 'invalid_scopes' }),
        );
      }
    }
  }
});

test('diagnostics isolate synchronous and asynchronous extension failures and redact identifiers', async () => {
  expect(() =>
    emit(
      () => {
        throw null;
      },
      { type: 'claims.invalid_scope' },
    ),
  ).not.toThrow();
  emit(
    async () => {
      throw new Error('private');
    },
    { type: 'claims.invalid_scope' },
  );
  emit(undefined, { type: 'claims.invalid_scope' });
  await Promise.resolve();
  expect(await safeKid(null)).toBeUndefined();
  expect(await safeKid('a\nb')).toBe('a?b');
  expect(await safeKid('x'.repeat(65))).toMatch(/^[0-9a-f]{64}$/);
});

test('runtime sharing follows jose checks with an explicit verifier override available', () => {
  expect(canShareInflight()).toBe(true);
  vi.stubGlobal('WebSocketPair', class {});
  expect(canShareInflight()).toBe(false);
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
  expect(canShareInflight()).toBe(false);
  vi.unstubAllGlobals();
  vi.stubGlobal('EdgeRuntime', 'vercel');
  expect(canShareInflight()).toBe(false);
  vi.stubGlobal('EdgeRuntime', 'other');
  expect(canShareInflight()).toBe(true);
});

test('header boundary regressions reject malformed arrays and embedded scheme prefixes', () => {
  expect(getBearerToken([''])).toEqual({ ok: false, reason: 'missing_token' });
  expect(getBearerToken([undefined] as unknown as string[])).toEqual({
    ok: false,
    reason: 'malformed_header',
  });
  expect(getBearerToken('Bearer a\x7f')).toEqual({ ok: false, reason: 'malformed_header' });
  expect(getBearerToken('prefix Bearer abc')).toEqual({ ok: false, reason: 'missing_token' });
  expect(getBearerToken('Bearer  ')).toEqual({ ok: false, reason: 'malformed_header' });
});
