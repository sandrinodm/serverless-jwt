/* oxlint-disable vitest/expect-expect -- The reject helper asserts the complete safe decision. */
import { describe, expect, it, vi } from 'vite-plus/test';

import type { ErrorReason, HttpError } from './errors.ts';

import { createGuard } from './adapter.ts';
import { JwtVerifierError, messages } from './errors.ts';

class ForeignError extends Error {
  readonly reason: ErrorReason;
  readonly code: string;
  readonly status: number;

  constructor(reason: ErrorReason = 'malformed_token') {
    const local = new JwtVerifierError(reason);
    super(local.message);
    this.name = 'JwtVerifierError';
    this.reason = reason;
    this.code = local.code;
    this.status = local.status;
  }

  toJSON(): HttpError['body'] {
    return new JwtVerifierError(this.reason).toJSON();
  }

  toHttp(): HttpError {
    return new JwtVerifierError(this.reason).toHttp();
  }
}

const decide = async (cause: unknown) =>
  createGuard({
    verifier: {
      issuer: 'https://issuer.test',
      audience: ['api'],
      warmup: async () => {},
      verify: async () => {
        throw cause;
      },
    },
  }).decide({
    method: 'GET',
    url: 'https://api.test',
    authorization: ['Bearer a.b.c'],
    header: () => undefined,
  });

const fallback = new JwtVerifierError('adapter_misconfigured').toHttp();

const reject = async (cause: unknown): Promise<void> => {
  const result = await decide(cause);
  expect(result.kind).toBe('reject');
  if (result.kind !== 'reject') {
    throw new Error('Expected rejection');
  }

  expect(result.http).toEqual(fallback);
  expect(result.error).toBeInstanceOf(JwtVerifierError);
};

describe('adapter copy normalization', () => {
  it('preserves same-copy error identity', async () => {
    const error = new JwtVerifierError('jwks_unavailable', { retryAfter: 17 });
    const result = await decide(error);
    expect(result.kind === 'reject' && result.error).toBe(error);
    expect(result.kind === 'reject' && result.http).toEqual(error.toHttp());
  });

  it.each(Object.keys(messages) as ErrorReason[])(
    'locally serializes canonical %s',
    async (reason) => {
      const error = new ForeignError(reason);
      const result = await decide(error);
      expect(result.kind).toBe('reject');
      if (result.kind !== 'reject') {
        throw new Error('Expected rejection');
      }

      expect(result.error).toBeInstanceOf(JwtVerifierError);
      expect(result.error).not.toBe(error);
      expect(result.http).toEqual(new JwtVerifierError(reason).toHttp());
      expect(result.error.cause).toBeUndefined();
    },
  );

  it.each([1, 2, 17, 30])(
    'preserves bounded retry %s through a local response',
    async (retryAfter) => {
      vi.spyOn(ForeignError.prototype, 'toHttp').mockImplementation(function () {
        return new JwtVerifierError('jwks_unavailable', { retryAfter }).toHttp();
      });
      const result = await decide(new ForeignError('jwks_unavailable'));
      expect(result.kind === 'reject' && result.http).toEqual(
        new JwtVerifierError('jwks_unavailable', { retryAfter }).toHttp(),
      );
    },
  );

  it.each([
    undefined,
    null,
    'private-secret',
    1,
    {},
    new Error('private-secret'),
    {
      ...Object.fromEntries(Object.entries(new ForeignError())),
      toHttp: () => new JwtVerifierError('malformed_token').toHttp(),
    },
    Object.create(null),
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('private-secret');
        },
      },
    ),
    new Proxy(new ForeignError(), {
      ownKeys: () => {
        throw new Error('private-secret');
      },
    }),
    new Proxy(new ForeignError(), {
      getOwnPropertyDescriptor: () => {
        throw new Error('private-secret');
      },
    }),
    new Proxy(new JwtVerifierError('jwks_unavailable'), {}),
  ])('contains arbitrary thrown values %#', reject);

  it.each([
    ['name', 'Error'],
    ['reason', 'constructor'],
    ['reason', '__proto__'],
    ['reason', 'unknown'],
    ['reason', 1],
    ['message', 'private-secret'],
    ['code', 'server_error'],
    ['status', 200],
    ['extra', 'private-secret'],
    [Symbol('secret'), 'private-secret'],
    ['toHttp', () => ({ status: 200 })],
  ] as const)('rejects inconsistent own field %s', async (key, value) => {
    const error = new ForeignError();
    Object.defineProperty(error, key, { value, configurable: true });
    await reject(error);
  });

  it.each(['reason', 'name', 'message', 'code', 'status', 'toHttp', 'cause'])(
    'never invokes %s accessors',
    async (key) => {
      const getter = vi.fn(() => {
        throw new Error('private-secret');
      });
      const error = Object.defineProperty(new ForeignError(), key, { get: getter });
      await reject(error);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it('rejects unusual error prototypes without invoking their methods', async () => {
    const error = new ForeignError();
    Object.setPrototypeOf(error, Object.create(ForeignError.prototype));
    await reject(error);
    Object.setPrototypeOf(error, Error.prototype);
    await reject(error);
  });

  it.each([
    () => undefined,
    () => null,
    () => 'private-secret',
    () => {
      throw new Error('private-secret');
    },
    () => Promise.reject('private-secret'),
    () =>
      Object.defineProperty({}, 'status', {
        get: () => {
          throw new Error('private-secret');
        },
      }),
    () => ({ ...new JwtVerifierError('malformed_token').toHttp(), status: 200 }),
    () => ({ ...new JwtVerifierError('malformed_token').toHttp(), extra: 'private-secret' }),
    () => ({
      ...new JwtVerifierError('malformed_token').toHttp(),
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-secret': 'private-secret',
      },
    }),
    () => ({ ...new JwtVerifierError('malformed_token').toHttp(), headers: {} }),
    () => ({
      ...new JwtVerifierError('malformed_token').toHttp(),
      body: { error: 'invalid_token', error_description: 'private-secret' },
    }),
    () => ({
      ...new JwtVerifierError('malformed_token').toHttp(),
      body: Promise.reject('private-secret'),
    }),
    () => ({
      ...new JwtVerifierError('malformed_token').toHttp(),
      headers: Promise.reject('private-secret'),
    }),
    () => ({
      ...new JwtVerifierError('malformed_token').toHttp(),
      body: Object.defineProperty({}, 'error', {
        get: () => {
          throw new Error('private-secret');
        },
      }),
    }),
    () => ({
      ...new JwtVerifierError('malformed_token').toHttp(),
      headers: new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('private-secret');
          },
        },
      ),
    }),
  ])('contains malformed serialization %#', async (serialize) => {
    vi.spyOn(ForeignError.prototype, 'toHttp').mockImplementation(serialize as () => HttpError);
    await reject(new ForeignError());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  it.each(['0', '31', '-1', '1.1', '01', '1\n', 'private-secret', 1, undefined])(
    'rejects noncanonical retry %#',
    async (retry) => {
      vi.spyOn(ForeignError.prototype, 'toHttp').mockImplementation(() => {
        const response = new JwtVerifierError('jwks_unavailable').toHttp();
        return { ...response, headers: { ...response.headers, 'retry-after': retry } } as HttpError;
      });
      await reject(new ForeignError('jwks_unavailable'));
    },
  );

  it.each(['toHttp', 'toJSON'] as const)(
    'rejects asynchronous %s before invocation',
    async (name) => {
      let calls = 0;
      const serialize = async () => {
        calls++;
        throw new Error('private-secret');
      };
      Object.defineProperty(ForeignError.prototype, name, { value: serialize, configurable: true });
      try {
        await reject(new ForeignError());
        expect(calls).toBe(0);
      } finally {
        // Restore the class method independently of Vitest's per-test mocks.
        Object.defineProperty(ForeignError.prototype, name, {
          value:
            name === 'toHttp'
              ? function (this: ForeignError) {
                  return new JwtVerifierError(this.reason).toHttp();
                }
              : function (this: ForeignError) {
                  return new JwtVerifierError(this.reason).toJSON();
                },
          configurable: true,
          writable: true,
        });
      }
    },
  );
});
