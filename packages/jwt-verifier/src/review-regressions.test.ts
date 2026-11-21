import { expect, test, vi } from 'vite-plus/test';

import { fixtureKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { boundedFetch } from './bounded-fetch.ts';
import { JwtVerifierError } from './errors.ts';
import { FetchState } from './fetch-state.ts';
import { createJwtVerifier } from './index.ts';
import { validateOptions } from './options.ts';

const base = { issuer: 'https://issuer.test', audience: 'api' };
const key = fixtureKey(2048);

function inputUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function rejection(promise: Promise<unknown>): Promise<JwtVerifierError> {
  return promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(JwtVerifierError);
      return error as JwtVerifierError;
    },
  );
}

test('an empty JWKS reports an outage during cooldown and recovers after cooldown', async () => {
  let now = 1_800_000_000_000;
  let keys: ReadonlyArray<unknown> = [];
  const fetch = vi.fn(async () => Response.json({ keys }));
  const verifier = createJwtVerifier({
    ...base,
    jwksUri: 'https://keys.test',
    keys: { cooldown: 3 },
    clock: { now: () => now },
    fetch,
  });
  const token = await mintToken({
    key,
    header: { kid: key.jwk.kid },
    payload: { iss: base.issuer, aud: 'api', exp: now / 1000 + 100 },
  });
  const failure = await rejection(verifier.warmup());
  expect(failure.reason).toBe('jwks_invalid');
  expect(failure.toHttp()).toMatchObject({ status: 503, headers: { 'retry-after': '1' } });
  await expect(verifier.verify(token)).rejects.toMatchObject({ reason: 'jwks_invalid' });
  await expect(verifier.warmup()).rejects.toMatchObject({ reason: 'jwks_invalid' });
  expect(fetch).toHaveBeenCalledTimes(1);

  now += 3_001;
  keys = [key.jwk];
  await verifier.verify(token);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([
  { name: 'empty JWKS on unknown-key refresh', invalidKeys: [], elapsed: 3_001, kid: 'new' },
  { name: 'all keys skipped after expiration', invalidKeys: [null], elapsed: 10_001, kid: 'old' },
])('$name clears cached keys even with stale-on-error enabled', async (scenario) => {
  let now = 1_800_000_000_000;
  let keys: ReadonlyArray<unknown> = [{ ...key.jwk, kid: 'old' }];
  const diagnostic = vi.fn();
  const fetch = vi.fn(async () => Response.json({ keys }));
  const verifier = createJwtVerifier({
    ...base,
    jwksUri: 'https://keys.test',
    keys: { cacheMaxAge: 10, cooldown: 3, staleIfError: 30 },
    clock: { now: () => now },
    onDiagnostic: diagnostic,
    fetch,
  });
  const token = (kid: string): Promise<string> =>
    mintToken({
      key,
      header: { kid },
      payload: { iss: base.issuer, aud: 'api', exp: Math.floor(now / 1000) + 100 },
    });
  const old = await token('old');
  await verifier.verify(old);
  now += scenario.elapsed;
  keys = scenario.invalidKeys;
  await expect(verifier.verify(await token(scenario.kid))).rejects.toMatchObject({
    reason: 'jwks_invalid',
    code: 'temporarily_unavailable',
  });
  await expect(verifier.verify(old)).rejects.toMatchObject({ reason: 'jwks_invalid' });
  expect(fetch).toHaveBeenCalledTimes(2);

  now += 3_001;
  fetch.mockRejectedValueOnce(new Error('outage'));
  await expect(verifier.verify(old)).rejects.toMatchObject({ reason: 'jwks_unavailable' });
  expect(diagnostic).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'jwks.stale_served' }),
  );
});

test('rotated tokens join a reserved shared refresh while nonsharing callers refuse immediately', async () => {
  for (const { shareInflight, cooldown } of [
    { shareInflight: true, cooldown: 30 },
    { shareInflight: false, cooldown: 30 },
    { shareInflight: true, cooldown: 0 },
    { shareInflight: false, cooldown: 0 },
  ]) {
    let now = 1_800_000_000_000;
    const refresh = deferred<void>();
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length === 1) {
        return Response.json({ keys: [{ ...key.jwk, kid: 'old' }] });
      }

      await refresh.promise;
      return Response.json({ keys: ['new-a', 'new-b'].map((kid) => ({ ...key.jwk, kid })) });
    });
    const verifier = createJwtVerifier({
      ...base,
      jwksUri: 'https://keys.test',
      shareInflight,
      keys: { cooldown },
      clock: { now: () => now },
      fetch: fetcher,
    });
    await verifier.warmup();
    now += 31_000;
    const tokens = await Promise.all(
      ['new-a', 'new-b'].map((kid) =>
        mintToken({
          key,
          header: { kid },
          payload: { iss: base.issuer, aud: 'api', exp: now / 1000 + 100 },
        }),
      ),
    );
    const first = verifier.verify(tokens[0] as string);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    let settled = 0;
    const concurrent = Array.from({ length: 20 }, (_, i) =>
      verifier
        .verify(tokens[i % 2] as string)
        .then(
          () => 'accepted',
          (error: JwtVerifierError) => error.reason,
        )
        .finally(() => {
          settled++;
        }),
    );
    if (!shareInflight) {
      await Promise.all(concurrent);
    }

    await Promise.resolve();
    expect(settled).toBe(shareInflight ? 0 : 20);

    expect(fetcher).toHaveBeenCalledTimes(2);
    refresh.resolve();
    await first;
    expect(await Promise.all(concurrent)).toEqual(
      Array.from({ length: 20 }, () => (shareInflight ? 'accepted' : 'key_not_found')),
    );
    const missing = await mintToken({
      key,
      header: { kid: 'missing' },
      payload: { iss: base.issuer, aud: 'api', exp: now / 1000 + 100 },
    });
    await expect(verifier.verify(missing)).rejects.toMatchObject({ reason: 'key_not_found' });
    expect(fetcher).toHaveBeenCalledTimes(cooldown === 0 ? 3 : 2);
  }
});

test('late abort-ignoring headers cancel their body without diagnostics, reading, parsing or unhandled rejection', async () => {
  vi.useFakeTimers();
  try {
    for (const kind of ['jwks', 'discovery'] as const) {
      for (const body of ['stream', 'null', 'reject-cancel'] as const) {
        const response = deferred<Response>();
        const diagnostic = vi.fn();
        const cancel = vi.fn(() =>
          body === 'reject-cancel' ? Promise.reject(new Error('cancel failed')) : undefined,
        );
        const stream = new ReadableStream<Uint8Array>(
          { pull: vi.fn(), cancel },
          { highWaterMark: 0 },
        );
        const getReader = vi.spyOn(stream, 'getReader');
        const pending = rejection(
          boundedFetch(
            validateOptions({
              ...base,
              fetch: () => response.promise,
              keys: { timeout: 1 },
              onDiagnostic: diagnostic,
            }),
            'url',
            kind,
          ),
        );
        await vi.advanceTimersByTimeAsync(1000);
        expect((await pending).reason).toBe(`${kind}_unavailable`);
        response.resolve(new Response(body === 'null' ? null : stream));
        await vi.advanceTimersByTimeAsync(0);
        expect(cancel).toHaveBeenCalledTimes(body === 'null' ? 0 : 1);
        expect(getReader).not.toHaveBeenCalled();
        expect(stream.locked).toBe(false);
        expect(diagnostic).not.toHaveBeenCalled();
      }
    }

    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')));
    const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
    const pending = rejection(
      boundedFetch(
        validateOptions({ ...base, fetch: async () => new Response(stream), keys: { timeout: 1 } }),
        'url',
        'jwks',
      ),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).reason).toBe('jwks_unavailable');
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

interface PendingFetch {
  readonly url: string;
  readonly response: ReturnType<typeof deferred<Response>>;
}

function controlledFetch(): {
  readonly fetcher: typeof fetch;
  readonly pending: PendingFetch[];
  readonly active: () => number;
  readonly maximum: () => number;
} {
  const pending: PendingFetch[] = [];
  let active = 0;
  let maximum = 0;
  return {
    pending,
    active: () => active,
    maximum: () => maximum,
    fetcher: async (input) => {
      const response = deferred<Response>();
      pending.push({ url: inputUrl(input), response });
      active++;
      maximum = Math.max(maximum, active);
      try {
        return await response.promise;
      } finally {
        active--;
      }
    },
  };
}

function metadata(uri = 'https://keys.test/old'): Response {
  return Response.json({ issuer: base.issuer, jwks_uri: uri });
}

function keys(): Response {
  return Response.json({ keys: [key.jwk] });
}

test('one verifier budget spans overlapping discovery and JWKS and frees failed capacity', async () => {
  let now = 0;
  const io = controlledFetch();
  const verifier = createJwtVerifier({
    ...base,
    shareInflight: false,
    clock: { now: () => now },
    fetch: io.fetcher,
    keys: { maxConcurrentFetches: 4 },
  });
  const cold = Array.from({ length: 4 }, () => verifier.warmup());
  await vi.waitFor(() => expect(io.pending).toHaveLength(4));
  const discoveryOverflow = await rejection(verifier.warmup());
  expect(discoveryOverflow.reason).toBe('jwks_unavailable');
  expect(discoveryOverflow.toHttp().headers['retry-after']).toBe('1');
  expect(io.pending).toHaveLength(4);
  io.pending[0]?.response.resolve(metadata());
  await vi.waitFor(() => expect(io.pending).toHaveLength(5));
  const blocked = await Promise.all(Array.from({ length: 3 }, () => rejection(verifier.warmup())));
  expect(blocked.map((error) => [error.reason, error.toHttp().headers['retry-after']])).toEqual(
    Array.from({ length: 3 }, () => ['jwks_unavailable', '1']),
  );
  expect(io.active()).toBe(4);
  const failed = rejection(cold[0] as Promise<void>);
  io.pending[4]?.response.reject(new Error('private outage'));
  expect((await failed).reason).toBe('jwks_unavailable');
  now += 31_000;
  const recovered = verifier.warmup();
  await vi.waitFor(() => expect(io.pending).toHaveLength(6));
  expect(io.active()).toBe(4);
  io.pending[5]?.response.resolve(keys());
  await recovered;
  for (const request of io.pending.slice(1, 4)) {
    request.response.resolve(metadata());
  }

  await Promise.all(cold.slice(1));
  expect(io.maximum()).toBe(4);
  expect(io.active()).toBe(0);
});

test('discovery URI rollover retains the budget while old stores are active and verifiers stay isolated', async () => {
  let now = 0;
  const io = controlledFetch();
  const verifier = createJwtVerifier({
    ...base,
    shareInflight: false,
    clock: { now: () => now },
    fetch: io.fetcher,
    keys: { maxConcurrentFetches: 4 },
  });
  const old = [verifier.warmup(), verifier.warmup()];
  await vi.waitFor(() => expect(io.pending).toHaveLength(2));
  for (const request of io.pending.slice(0, 2)) {
    request.response.resolve(metadata());
  }

  await vi.waitFor(() => expect(io.pending).toHaveLength(4));
  now += 86_400_001;
  const fresh = [verifier.warmup()];
  await vi.waitFor(() => expect(io.pending).toHaveLength(5));
  io.pending[4]?.response.resolve(metadata('https://keys.test/new'));
  await vi.waitFor(() => expect(io.pending).toHaveLength(6));
  expect(io.pending[5]?.url).toBe('https://keys.test/new');
  fresh.push(verifier.warmup());
  await vi.waitFor(() => expect(io.pending).toHaveLength(7));
  expect(io.pending[6]?.url).toBe('https://keys.test/new');
  expect((await rejection(verifier.warmup())).reason).toBe('jwks_unavailable');
  expect(io.active()).toBe(4);
  await createJwtVerifier({
    ...base,
    shareInflight: false,
    keys: { maxConcurrentFetches: 1 },
    fetch: async (url) => (inputUrl(url).includes('.well-known') ? metadata() : keys()),
  }).warmup();
  for (const request of [...io.pending.slice(2, 4), ...io.pending.slice(5)]) {
    request.response.resolve(keys());
  }

  await Promise.all([...old, ...fresh]);
  expect(io.maximum()).toBe(4);
  expect(io.active()).toBe(0);
});

test('timed-out discovery and JWKS reservations release capacity for the next endpoint operation', async () => {
  vi.useFakeTimers();
  try {
    for (const stage of ['discovery', 'jwks']) {
      let now = 0;
      let fail = true;
      const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (fail && inputUrl(url).includes('.well-known') === (stage === 'discovery')) {
          return new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            }),
          );
        }

        return inputUrl(url).includes('.well-known') ? metadata() : keys();
      });
      const verifier = createJwtVerifier({
        ...base,
        shareInflight: false,
        clock: { now: () => now },
        fetch: fetcher,
        keys: { maxConcurrentFetches: 1, timeout: 1 },
      });
      const first = rejection(verifier.warmup());
      await vi.advanceTimersByTimeAsync(1000);
      expect((await first).reason).toBe(`${stage}_unavailable`);
      fail = false;
      now += 31_000;
      await verifier.warmup();
      expect(fetcher).toHaveBeenCalledTimes(3);
    }
  } finally {
    vi.useRealTimers();
  }
});

test('initiating network failures advertise the new bounded backoff and retain reason, cause and fixed text', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(1);
  const invalidCause = expect.any(SyntaxError);
  for (const kind of ['jwks', 'discovery'] as const) {
    for (const invalid of [false, true]) {
      let now = 0;
      const privateCause = new Error('private endpoint or credential');
      const verifier = createJwtVerifier({
        ...base,
        ...(kind === 'jwks' ? { jwksUri: 'https://keys.test' } : {}),
        clock: { now: () => now },
        fetch: async () => {
          if (invalid) {
            return new Response('!');
          }

          throw privateCause;
        },
      });
      for (let attempt = 0; attempt < 7; attempt++) {
        const error = await rejection(verifier.warmup());
        const blocked = await rejection(verifier.warmup());
        const reason = `${kind}_${invalid ? 'invalid' : 'unavailable'}` as const;
        expect(error.reason).toBe(reason);
        expect(error.message).toBe(new JwtVerifierError(reason).message);
        expect(error.cause).toEqual(invalid ? invalidCause : privateCause);
        expect(error.cause === privateCause).toBe(!invalid);
        expect(Object.keys(error)).not.toContain('cause');
        expect(JSON.stringify(error)).not.toContain('private');
        const delay = String(Math.min(30, 2 ** attempt));
        expect(error.toHttp().headers['retry-after']).toBe(delay);
        expect(blocked.toHttp().headers['retry-after']).toBe(delay);
        now += 31_000;
      }
    }
  }

  for (const reason of ['deadline_exceeded', 'request_aborted', 'key_not_found'] as const) {
    let now = 0;
    const state = new FetchState<string>(
      validateOptions({ ...base, clock: { now: () => now } }),
      'jwks',
    );
    const error = new JwtVerifierError(reason);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        await rejection(
          state.load(async () => {
            throw error;
          }),
        ),
      ).toBe(error);
      expect(error.toHttp().headers['retry-after']).toBe(
        reason === 'key_not_found' ? undefined : '1',
      );

      now += 31_000;
    }
  }
});

test('selection misses racing refresh completion retry the replaced cache throughout microtask interleavings', async () => {
  const initial = 1_800_000_000_000;
  const token = await mintToken({
    key,
    header: { kid: 'new' },
    payload: { iss: base.issuer, aud: 'api', exp: initial / 1000 + 1000 },
  });
  for (let ticks = 0; ticks < 64; ticks++) {
    let now = initial;
    const started = deferred<void>();
    const refresh = deferred<void>();
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length === 1) {
        return Response.json({ keys: [{ ...key.jwk, kid: 'old' }] });
      }

      started.resolve();
      await refresh.promise;
      return Response.json({ keys: [{ ...key.jwk, kid: 'new' }] });
    });
    const verifier = createJwtVerifier({
      ...base,
      jwksUri: 'https://keys.test',
      fetch: fetcher,
      clock: { now: () => now },
    });
    await verifier.warmup();
    now += 31_000;
    const first = verifier.verify(token);
    await started.promise;
    refresh.resolve();
    for (let tick = 0; tick < ticks; tick++) {
      await Promise.resolve();
    }

    const second = verifier.verify(token);
    const outcomes = await Promise.all(
      [first, second].map((pending) =>
        pending.then(
          () => 'accepted',
          (error: JwtVerifierError) => error.reason,
        ),
      ),
    );
    expect(outcomes, `refresh completion after ${ticks} microtasks`).toEqual([
      'accepted',
      'accepted',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});

test('discarded non-success and redirected bodies are cancelled without waiting for cancellation', async () => {
  for (const kind of ['jwks', 'discovery'] as const) {
    for (const status of [302, 503, 200]) {
      for (const behavior of ['resolved', 'rejected', 'pending']) {
        const cancel = vi.fn(() => {
          if (behavior === 'rejected') {
            return Promise.reject(new Error('private cancellation failure'));
          }

          if (behavior === 'pending') {
            return new Promise<void>(() => {});
          }

          return Promise.resolve();
        });
        const stream = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
        const getReader = vi.spyOn(stream, 'getReader');
        const response = new Response(stream, { status });
        if (status === 200) {
          Object.defineProperty(response, 'redirected', { value: true });
        }

        const error = await rejection(
          boundedFetch(validateOptions({ ...base, fetch: async () => response }), 'url', kind),
        );
        expect(error.reason).toBe(`${kind}_unavailable`);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(getReader).not.toHaveBeenCalled();
        expect(stream.locked).toBe(false);
      }
    }

    const error = await rejection(
      boundedFetch(
        validateOptions({ ...base, fetch: async () => new Response(null, { status: 503 }) }),
        'url',
        kind,
      ),
    );
    expect(error.reason).toBe(`${kind}_unavailable`);
  }
});
