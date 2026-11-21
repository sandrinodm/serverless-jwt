import fc from 'fast-check';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, expectTypeOf, test, vi } from 'vite-plus/test';

import type { JwtVerifierOptions } from './options.ts';
import type { Auth } from './verify.ts';

import { JwtVerifierError } from './errors.ts';
import { createJwtVerifier, joseReason, checkProfileClaims } from './verify.ts';

const pair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'valid' };
const now = 1_800_000_000_000;
const defaults = {
  issuer: 'https://issuer.test',
  audience: 'api',
  jwksUri: 'https://issuer.test/jwks',
  clock: { now: (): number => now },
  fetch: vi.fn(async () => Response.json({ keys: [jwk] })),
};
const runs = process.env.NIGHTLY ? 100_000 : 1_000;

async function mint(
  payload: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({
    iss: defaults.issuer,
    aud: 'api',
    exp: now / 1000 + 100,
    iat: now / 1000,
    sub: 'subject',
    ...payload,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'valid', ...header })
    .sign(pair.privateKey);
}

test('verifies original immutable claims, preserves identity separation and derives scopes before mapping', async () => {
  const fetcher = vi.fn(defaults.fetch);
  const verifier = createJwtVerifier({
    ...defaults,
    fetch: fetcher,
    mapClaims: (claims) => ({ sub: claims.sub, scope: 'admin' }),
  });
  await verifier.warmup();
  const token = await mint({ scope: 'read', nested: { list: [{ value: 1 }] } });
  const auth = await verifier.verify(token);
  expect(auth.token).toBe(token);
  expect(auth.identity).toEqual({ sub: 'subject', scope: 'admin' });
  expect(auth.scopes).toEqual(['read']);
  expect(auth.claims.scope).toBe('read');
  expect(Object.getPrototypeOf(auth.claims)).toBeNull();
  expect(Object.isFrozen(auth.claims)).toBe(true);
  expect(Object.isFrozen(auth)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expectTypeOf(auth).toEqualTypeOf<Auth<{ sub: unknown; scope: string }>>();
  expectTypeOf(verifier.verify(token)).toEqualTypeOf<
    Promise<Auth<{ sub: unknown; scope: string }>>
  >();
  // @ts-expect-error Symmetric algorithms cannot enter the typed allowlist.
  const invalid: JwtVerifierOptions = { issuer: 'x', audience: 'api', algorithms: ['HS256'] };
  void invalid;
});

test.each([null, undefined, 'primitive', 42])(
  'mapping output must be an object %#',
  async (value) => {
    const verifier = createJwtVerifier({ ...defaults, mapClaims: () => value });
    await expect(verifier.verify(await mint())).rejects.toMatchObject({ reason: 'mapping_failed' });
  },
);

test('catches thrown non-Errors and preserves safe mapping failure even when mapper throws another verifier error', async () => {
  for (const value of [
    null,
    'private',
    new Error('secret'),
    new JwtVerifierError('signature_invalid'),
  ]) {
    const verifier = createJwtVerifier({
      ...defaults,
      mapClaims: () => {
        throw value;
      },
    });
    await expect(verifier.verify(await mint())).rejects.toMatchObject({ reason: 'mapping_failed' });
  }
});

test('profile validates typ and claim types beyond the signature and accepts application prefix case insensitively', async () => {
  const verifier = createJwtVerifier({ ...defaults, profile: 'rfc9068' });
  for (const typ of [undefined, 0, 'JWT', 'at+jwt;wrong']) {
    await expect(
      verifier.verify(await mint({ client_id: 'client', jti: 'id' }, { typ })),
    ).rejects.toMatchObject({ reason: 'claim_type' });
  }

  for (const payload of [
    { sub: '' },
    { sub: 3 },
    { client_id: '' },
    { client_id: 3 },
    { jti: '' },
    { jti: 3 },
    { aud: [] },
    { aud: [3] },
  ]) {
    await expect(
      verifier.verify(
        await mint({ client_id: 'client', jti: 'id', ...payload }, { typ: 'at+jwt' }),
      ),
    ).rejects.toBeInstanceOf(JwtVerifierError);
  }

  expect(
    (
      await verifier.verify(
        await mint({ client_id: 'client', jti: 'id' }, { typ: 'APPLICATION/AT+JWT' }),
      )
    ).claims.client_id,
  ).toBe('client');
});

test('enforces numeric-date rejection before temporal validation and iat even without age policy', async () => {
  for (const name of ['iat', 'exp', 'nbf']) {
    for (const value of [0.5, '1', null, -1e20, 1e20]) {
      await expect(
        createJwtVerifier(defaults).verify(await mint({ [name]: value })),
      ).rejects.toMatchObject({ reason: 'malformed_token' });
    }
  }

  await expect(
    createJwtVerifier(defaults).verify(await mint({ iat: now / 1000 + 6 })),
  ).rejects.toMatchObject({ reason: 'token_issued_in_future' });
  await expect(
    createJwtVerifier({ ...defaults, maxTokenAge: 10 }).verify(
      await mint({ iat: now / 1000 - 16 }),
    ),
  ).rejects.toMatchObject({ reason: 'token_too_old' });
  expect(
    (
      await createJwtVerifier({ ...defaults, requireExp: false }).verify(
        await mint({ exp: undefined }),
      )
    ).claims.sub,
  ).toBe('subject');
});

test('disallowed algorithms and shape failures never fetch; critical extensions are rejected', async () => {
  const fetcher = vi.fn(defaults.fetch);
  const verifier = createJwtVerifier({ ...defaults, fetch: fetcher });
  await expect(verifier.verify('a.b.c')).rejects.toMatchObject({ reason: 'malformed_token' });
  const parts = (await mint()).split('.');
  for (const header of [
    { alg: 'none' },
    { alg: 'HS256' },
    { alg: 'RS256', crit: ['unknown'] },
    { alg: 'RS256', crit: 'bad' },
  ]) {
    parts[0] = Buffer.from(JSON.stringify(header)).toString('base64url');
    await expect(verifier.verify(parts.join('.'))).rejects.toBeInstanceOf(JwtVerifierError);
  }

  expect(fetcher).not.toHaveBeenCalled();
});

test('generic audience warning emits once and ignores failed tokens or unrelated clients', async () => {
  const diagnostic = vi.fn();
  const verifier = createJwtVerifier({ ...defaults, onDiagnostic: diagnostic });
  await verifier.verify(await mint({ azp: 'other' }));
  await expect(verifier.verify(await mint({ aud: 'wrong', azp: 'api' }))).rejects.toBeInstanceOf(
    JwtVerifierError,
  );
  await verifier.verify(await mint({ azp: 'api' }));
  await verifier.verify(await mint({ client_id: 'api' }));
  expect(
    diagnostic.mock.calls.filter(
      ([event]) => event.type === 'config.audience_looks_like_client_id',
    ),
  ).toHaveLength(1);
  const plain = createJwtVerifier(defaults);
  const auth = await plain.verify(await mint());
  expect(auth.identity).toBe(auth.claims);
});

test('every jose code and claim mapping is stable and non-Errors fall back safely', () => {
  const cases: [unknown, string][] = [
    [null, 'malformed_token'],
    [{}, 'malformed_token'],
    [{ code: 'ERR_JWT_EXPIRED' }, 'token_expired'],
    [{ code: 'ERR_JWT_EXPIRED', claim: 'iat' }, 'token_too_old'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', reason: 'missing' }, 'claim_missing'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' }, 'claim_issuer'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' }, 'claim_audience'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'nbf' }, 'token_not_yet_valid'],
    [{ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'sub' }, 'claim_type'],
    [{ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }, 'signature_invalid'],
  ];
  for (const [value, reason] of cases) {
    expect(joseReason(value)).toBe(reason);
  }
});

test('property: untrusted strings never verify and always reject with the typed error', async () => {
  const verifier = createJwtVerifier(defaults);
  await fc.assert(
    fc.asyncProperty(fc.string(), async (token) => {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(JwtVerifierError);
    }),
    { numRuns: runs },
  );
});

test(
  'property: a token signed by a key outside the trusted set never verifies',
  async () => {
    const outsider = await generateKeyPair('RS256');
    const verifier = createJwtVerifier(defaults);
    await verifier.warmup();
    const signed = await new SignJWT({ iss: defaults.issuer, aud: 'api', exp: now / 1000 + 100 })
      .setProtectedHeader({ alg: 'RS256', kid: 'valid' })
      .sign(outsider.privateKey);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 2 }), async (selection) => {
        const token =
          selection === 0 ? signed : selection === 1 ? signed.replace(/.$/, '!') : signed + 'x';
        await expect(verifier.verify(token)).rejects.toBeInstanceOf(JwtVerifierError);
      }),
      { numRuns: runs },
    );
  },
  process.env.NIGHTLY ? 120_000 : 5_000,
);

test('one deadline bounds never-settling fetch and async mapClaims and already aborted signals', async () => {
  const signed = await mint();
  vi.useFakeTimers();
  try {
    for (const options of [
      { fetch: () => new Promise<Response>(() => {}) },
      { mapClaims: () => new Promise<object>(() => {}) },
    ]) {
      const pending = createJwtVerifier({ ...defaults, ...options, verifyTimeout: 1 }).verify(
        signed,
      );
      const assertion = expectRejection(pending, 'deadline_exceeded');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    }

    const controller = new AbortController();
    controller.abort();
    await expect(
      createJwtVerifier(defaults).verify(signed, { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: 'request_aborted' });
  } finally {
    vi.useRealTimers();
  }
});

test('caller abort is local while another verification completes its shared fetch', async () => {
  const signed = await mint();
  let release: (value: Response) => void = () => {};
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const verifier = createJwtVerifier({ ...defaults, fetch: fetcher });
  const controller = new AbortController();
  const first = verifier.verify(signed, { signal: controller.signal });
  const second = verifier.verify(signed);
  const rejected = expectRejection(first, 'request_aborted');
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort();
  await rejected;
  release(Response.json({ keys: [jwk] }));
  expect((await second).claims.sub).toBe('subject');
});

test('warmup normalizes unexpected failures and finite deadline', async () => {
  await expect(
    createJwtVerifier({
      ...defaults,
      fetch: async () => {
        throw null;
      },
    }).warmup(),
  ).rejects.toMatchObject({ reason: 'jwks_unavailable' });
});

test('profile claim guard checks all audience shapes independently of jose claim matching', () => {
  for (const aud of ['api', ['api'], ['api', 'other']]) {
    expect(() => checkProfileClaims({ sub: 's', client_id: 'c', jti: 'j', aud })).not.toThrow();
  }

  for (const aud of ['', [], ['api', ''], ['api', 3], null, 1, {}]) {
    expect(() => checkProfileClaims({ sub: 's', client_id: 'c', jti: 'j', aud } as never)).toThrow(
      expect.objectContaining({ reason: 'claim_type' }),
    );
  }
});

test('warmup wraps unexpected clock failures and async mapper deadline is enforced after signature verification', async () => {
  await expect(
    createJwtVerifier({
      ...defaults,
      clock: {
        now: () => {
          throw null;
        },
      },
    }).warmup(),
  ).rejects.toMatchObject({ reason: 'jwks_unavailable' });
  const token = await mint();
  let mapping = false;
  const verifier = createJwtVerifier({
    ...defaults,
    verifyTimeout: 1,
    mapClaims: () => {
      mapping = true;
      return new Promise<object>(() => {});
    },
  });
  vi.useFakeTimers();
  try {
    const pending = verifier.verify(token);
    const rejected = expectRejection(pending, 'deadline_exceeded');
    await vi.waitFor(() => expect(mapping).toBe(true));
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});

async function expectRejection(pending: Promise<unknown>, reason: string): Promise<void> {
  await expect(pending).rejects.toMatchObject({ reason });
}

test('discovery URI replacement drops the old store and fetches new keys at 24h boundary', async () => {
  let instant = now;
  let endpoint = 'https://issuer.test/old';
  const fetched: string[] = [];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    return Response.json(
      url.includes('.well-known')
        ? { issuer: defaults.issuer, jwks_uri: endpoint }
        : { keys: [jwk] },
    );
  };
  const verifier = createJwtVerifier({
    issuer: defaults.issuer,
    audience: 'api',
    clock: { now: () => instant },
    fetch: fetcher,
  });
  await verifier.warmup();
  await verifier.warmup();
  instant += 86_400_000;
  endpoint = 'https://issuer.test/new';
  await verifier.warmup();
  expect(fetched).toEqual([
    'https://issuer.test/.well-known/openid-configuration',
    'https://issuer.test/old',
    'https://issuer.test/.well-known/openid-configuration',
    'https://issuer.test/new',
  ]);
});

test('security boundaries preserve exact failure reasons, diagnostics and claim edge conditions', async () => {
  const diagnostic = vi.fn();
  const verifier = createJwtVerifier({
    ...defaults,
    audience: ['other', 'api'],
    onDiagnostic: diagnostic,
  });
  await verifier.verify(await mint({ client_id: 'api' }));
  await verifier.verify(await mint({ azp: 'api' }));
  expect(
    diagnostic.mock.calls.filter(
      ([event]) => event.type === 'config.audience_looks_like_client_id',
    ),
  ).toHaveLength(1);
  expect(
    diagnostic.mock.calls.filter(
      ([event]) => event.type === 'config.audience_looks_like_client_id',
    ),
  ).toEqual([[{ type: 'config.audience_looks_like_client_id' }]]);
  await expect(verifier.verify(await mint({ aud: 'wrong' }))).rejects.toMatchObject({
    reason: 'claim_audience',
  });
  expect(diagnostic).toHaveBeenLastCalledWith({
    type: 'verify.rejected',
    reason: 'claim_audience',
  });
  expect((await verifier.verify(await mint({ iat: now / 1000 + 5 }))).claims.sub).toBe('subject');
  for (const value of [9_007_199_254_741, -9_007_199_254_741]) {
    await expect(verifier.verify(await mint({ iat: value }))).rejects.toMatchObject({
      reason: 'malformed_token',
    });
  }

  const rfc = createJwtVerifier({ ...defaults, profile: 'rfc9068' });
  await expect(
    rfc.verify(await mint({ client_id: 'c', jti: 'j' }, { typ: 'prefix at+jwt' })),
  ).rejects.toMatchObject({ reason: 'claim_type' });
  const at = await rfc.verify(
    await mint({ client_id: 'c', jti: 'j', aud: ['api', 'other'] }, { typ: 'at+jwt' }),
  );
  expect(at.claims.sub).toBe('subject');
  const missingClaims = createJwtVerifier({ ...defaults, requiredClaims: ['custom'] });
  await expect(missingClaims.verify(await mint())).rejects.toMatchObject({
    reason: 'claim_missing',
  });
  expect(() =>
    checkProfileClaims({ sub: 's', client_id: 'c', jti: 'j', aud: ['api', ''] }),
  ).toThrow(expect.objectContaining({ reason: 'claim_type' }));
});

test('maxTokenAge preserves the issued-in-future reason instead of a generic claim type failure', async () => {
  await expect(
    createJwtVerifier({ ...defaults, maxTokenAge: 10 }).verify(await mint({ iat: now / 1000 + 6 })),
  ).rejects.toMatchObject({ reason: 'token_issued_in_future' });
});

test(
  'property: every token settles within its total deadline even when fetch ignores abort',
  async () => {
    const signed = await mint();
    vi.useFakeTimers();
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.oneof(fc.constant(signed), fc.string()),
          fc.boolean(),
          async (token, abort) => {
            const controller = new AbortController();
            const verifier = createJwtVerifier({
              ...defaults,
              verifyTimeout: 1,
              fetch: () => new Promise<Response>(() => {}),
            });
            const started = Date.now();
            let completed = false;
            let reason: unknown;
            const pending = verifier.verify(token, { signal: controller.signal }).then(
              () => {
                throw new Error('Untrusted input was accepted');
              },
              (error: unknown) => {
                completed = true;
                reason = error;
              },
            );
            if (abort) {
              controller.abort();
            }

            await vi.advanceTimersByTimeAsync(1001);
            await pending;
            expect(completed).toBe(true);
            expect(reason).toBeInstanceOf(JwtVerifierError);
            expect(Date.now() - started).toBeLessThanOrEqual(1001);
            // The owned fetch remains independent of caller cancellation and closes under its own limit.
            await vi.advanceTimersByTimeAsync(5000);
          },
        ),
        { numRuns: runs },
      );
    } finally {
      vi.useRealTimers();
    }
  },
  process.env.NIGHTLY ? 120_000 : 5_000,
);
