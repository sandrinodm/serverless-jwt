import { expect, test, vi } from 'vite-plus/test';

import { fixtureKey } from '../../testkit/src/keys.ts';
import { mintToken } from '../../testkit/src/tokens.ts';
import { boundedFetch } from './bounded-fetch.ts';
import { Deadline } from './deadline.ts';
import { validateOptions } from './options.ts';
import { createJwtVerifier } from './verify.ts';

const base = { issuer: 'https://issuer.test', audience: 'api' };

test('bounded streams ignore dishonest content-length, reject excess bytes, UTF8/JSON errors and null bodies', async () => {
  for (const kind of ['jwks', 'discovery'] as const) {
    const reason = kind === 'jwks' ? 'jwks_invalid' : 'discovery_invalid';
    for (const response of [
      new Response('!'),
      new Response(new Uint8Array([255])),
      new Response(null),
      new Response('a'.repeat(kind === 'discovery' ? 65_537 : 11), {
        headers: { 'content-length': '1' },
      }),
    ]) {
      const options = validateOptions({
        ...base,
        fetch: async () => response,
        keys: { maxResponseBytes: 10 },
      });
      await expect(boundedFetch(options, 'url', kind)).rejects.toMatchObject({ reason });
    }

    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    expect(
      await boundedFetch(validateOptions({ ...base, fetch: fetcher }), 'https://issuer.test', kind),
    ).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      'https://issuer.test',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    for (const response of [
      new Response('', { status: 503 }),
      Object.assign(new Response('{}'), {}),
    ]) {
      if (response.status === 200) {
        Object.defineProperty(response, 'redirected', { value: true });
      }

      await expect(
        boundedFetch(validateOptions({ ...base, fetch: async () => response }), 'url', kind),
      ).rejects.toMatchObject({
        reason: kind === 'jwks' ? 'jwks_unavailable' : 'discovery_unavailable',
      });
    }

    await expect(
      boundedFetch(
        validateOptions({
          ...base,
          fetch: async () => {
            throw null;
          },
        }),
        'url',
        kind,
      ),
    ).rejects.toMatchObject({
      reason: kind === 'jwks' ? 'jwks_unavailable' : 'discovery_unavailable',
    });
  }
});

test('counts multiple chunks to the exact limit and cancels on a stuck reader or ignored abort', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"'));
      controller.enqueue(new TextEncoder().encode('ok":true}'));
      controller.close();
    },
  });
  expect(
    await boundedFetch(
      validateOptions({
        ...base,
        fetch: async () => new Response(stream),
        keys: { maxResponseBytes: 11 },
      }),
      'url',
      'jwks',
    ),
  ).toEqual({ ok: true });
  vi.useFakeTimers();
  try {
    for (const fetcher of [
      () => new Promise<Response>(() => {}),
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([123]));
            },
          }),
        ),
    ]) {
      const pending = boundedFetch(
        validateOptions({ ...base, fetch: fetcher, keys: { timeout: 1 } }),
        'url',
        'jwks',
      );
      const rejected = expectRejection(pending, 'jwks_unavailable');
      await vi.advanceTimersByTimeAsync(1001);
      await rejected;
    }
  } finally {
    vi.useRealTimers();
  }
});

test('deadline race cleans up abort listeners, returns success, and rejects before or during an operation', async () => {
  vi.useFakeTimers();
  try {
    const signal = new AbortController();
    const deadline = new Deadline(1, signal.signal);
    expect(await deadline.race(3)).toBe(3);
    const pending = deadline.race(new Promise<void>(() => {}));
    const rejected = expectRejection(pending, 'request_aborted');
    signal.abort();
    await rejected;
    deadline.close();
    const expired = new Deadline(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(expired.race(3)).rejects.toMatchObject({ reason: 'deadline_exceeded' });
    expired.close();
  } finally {
    vi.useRealTimers();
  }
});

test('slow discovery and slow JWKS share one total verification deadline', async () => {
  expect.hasAssertions();
  const key = fixtureKey(2048);
  const token = await mintToken({
    key,
    header: {},
    payload: { iss: base.issuer, aud: 'api', exp: 1_800_000_100 },
  });
  vi.useFakeTimers();
  try {
    const fetcher = async (url: RequestInfo | URL): Promise<Response> => {
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
      return Response.json(
        (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
          '.well-known',
        )
          ? { issuer: base.issuer, jwks_uri: 'https://issuer.test/jwks' }
          : { keys: [key.jwk] },
      );
    };
    const verifier = createJwtVerifier({
      ...base,
      clock: { now: () => 1_800_000_000_000 },
      fetch: fetcher,
      verifyTimeout: 1,
    });
    const pending = verifier.verify(token);
    const rejected = expectRejection(pending, 'deadline_exceeded');
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
  } finally {
    vi.useRealTimers();
  }
});

async function expectRejection(pending: Promise<unknown>, reason: string): Promise<void> {
  await expect(pending).rejects.toMatchObject({ reason });
}

test('workerd manual redirect fallback rejects 3xx without following the location', async () => {
  vi.stubGlobal('WebSocketPair', class {});
  const fetcher = vi.fn(
    async () => new Response('', { status: 302, headers: { location: 'https://attacker.test' } }),
  );
  await expect(
    boundedFetch(validateOptions({ ...base, fetch: fetcher }), 'https://issuer.test/keys', 'jwks'),
  ).rejects.toMatchObject({ reason: 'jwks_unavailable' });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://issuer.test/keys',
    expect.objectContaining({ redirect: 'manual', credentials: 'omit' }),
  );
});
