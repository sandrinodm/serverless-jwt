/* oxlint-disable typescript/no-deprecated -- Proves the explicitly transitional entry. */
import type { Handler, HandlerContext, HandlerResponse } from '@netlify/functions';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { expect, expectTypeOf, it } from 'vite-plus/test';

import { apiGatewayV1, context } from '../../testkit/fixtures/aws/events.ts';
import { withJwt } from './v1.ts';

it('preserves Netlify clientContext and every original platform argument', async () => {
  const event = { ...apiGatewayV1(), rawUrl: 'https://resource.example/protected', rawQuery: '' };
  const { identity: _identity, clientContext: _clientContext, ...lambdaContext } = context();
  const clientContext = { platform: 'original', user: { id: 'netlify-user' } };
  const ctx: HandlerContext = { ...lambdaContext, clientContext };
  const result = { statusCode: 202, body: 'unchanged' };
  const wrapped: Handler = withJwt(
    { issuer: 'https://issuer.example', audience: 'api', skip: () => true },
    async (passed, original, auth) => {
      expect(passed).toBe(event);
      expect(original).toBe(ctx);
      expect(original.clientContext).toBe(clientContext);
      expect(auth).toBeUndefined();
      expectTypeOf(original).toEqualTypeOf<HandlerContext>();
      return result;
    },
  );
  expect(await wrapped(event, ctx)).toBe(result);
  expect(ctx.clientContext).toBe(clientContext);
});

it('fails malformed cancellation callbacks closed and observes rejected thenables', async () => {
  const event = { ...apiGatewayV1(), rawUrl: 'https://resource.example/protected', rawQuery: '' };
  const { identity: _identity, clientContext: _clientContext, ...ctx } = context();
  for (const callback of [
    () => {
      throw 'private';
    },
    () => Promise.reject('private'),
    () => true,
  ]) {
    const wrapped = withJwt(
      {
        issuer: 'https://issuer.example',
        audience: 'api',
        getSignal: callback as unknown as () => AbortSignal,
      },
      async () => ({ statusCode: 200 }),
    );
    const result = await wrapped(event, ctx);
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('private');
  }
});

it('validates callbacks, preserves the cheap header view and checks native custom results', async () => {
  const event = { ...apiGatewayV1(), rawUrl: 'https://resource.example/protected', rawQuery: '' };
  const { identity: _identity, clientContext: _clientContext, ...ctx } = context();
  const policy = { issuer: 'https://issuer.example', audience: 'api' };
  expect(() =>
    withJwt({ ...policy, getSignal: 42 as unknown as () => AbortSignal }, async () => ({
      statusCode: 200,
    })),
  ).toThrow(JwtVerifierError);
  event.headers = { 'X-Probe': 'present' };
  const skipped = withJwt(
    {
      ...policy,
      skip: (view) => {
        expect(view.header('x-probe')).toBe('present');
        expect(view.header('absent')).toBeUndefined();
        return true;
      },
    },
    async () => ({ statusCode: 200, body: 'skipped' }),
  );
  expect((await skipped(event, ctx)).body).toBe('skipped');
  for (const invalid of [
    null,
    false,
    42,
    {},
    { statusCode: '418' },
    { statusCode: 418.5 },
    { statusCode: 99 },
    { statusCode: 600 },
    { statusCode: 418, body: {} },
  ]) {
    const wrapped = withJwt(
      { ...policy, onError: () => invalid as { statusCode: number; body: string } },
      async () => ({ statusCode: 200 }),
    );
    expect((await wrapped(event, ctx)).statusCode).toBe(401);
  }

  expect(
    (
      await withJwt({ ...policy, onError: () => ({ statusCode: 418 }) }, async () => ({
        statusCode: 200,
      }))(event, ctx)
    ).statusCode,
  ).toBe(418);
});

it('handles absent native header containers without inventing credentials', async () => {
  const { identity: _identity, clientContext: _clientContext, ...ctx } = context();
  for (const absent of ['missing', 'undefined'] as const) {
    const event = { ...apiGatewayV1(), rawUrl: 'https://resource.example/protected', rawQuery: '' };
    if (absent === 'missing') {
      Reflect.deleteProperty(event, 'multiValueHeaders');
    } else {
      Reflect.set(event, 'multiValueHeaders', undefined);
    }

    Reflect.deleteProperty(event, 'headers');
    const wrapped = withJwt(
      {
        issuer: 'https://issuer.example',
        audience: 'api',
        skip: (view) => {
          expect(view.header('absent')).toBeUndefined();
          return true;
        },
      },
      async () => ({ statusCode: 200 }),
    );
    expect((await wrapped(event, ctx)).statusCode).toBe(200);
  }
});

it('validates native JavaScript result fields without rejecting omitted Netlify bodies', async () => {
  const event = { ...apiGatewayV1(), rawUrl: 'https://resource.example/protected', rawQuery: '' };
  const { identity: _identity, clientContext: _clientContext, ...ctx } = context();
  const policy = { issuer: 'https://issuer.example', audience: 'api' };
  const run = (value: unknown) =>
    withJwt({ ...policy, onError: () => value as HandlerResponse }, async () => ({
      statusCode: 200,
    }))(event, ctx);
  for (const invalid of [
    null,
    false,
    42,
    [],
    {},
    { statusCode: '418' },
    { statusCode: 418.5 },
    { statusCode: 99 },
    { statusCode: 600 },
    { statusCode: 418, body: {} },
    { statusCode: 418, isBase64Encoded: 'true' },
    { statusCode: 418, headers: 'bad' },
    { statusCode: 418, headers: [] },
    { statusCode: 418, headers: { 'bad name': 'x' } },
    { statusCode: 418, headers: { x: 'one\r\ntwo' } },
    { statusCode: 418, headers: { x: NaN } },
    { statusCode: 418, multiValueHeaders: 'bad' },
    { statusCode: 418, multiValueHeaders: { x: 'bad' } },
    { statusCode: 418, multiValueHeaders: { x: [{}] } },
  ]) {
    expect((await run(invalid)).statusCode).toBe(401);
  }

  for (const valid of [
    { statusCode: 418 },
    {
      statusCode: 418,
      body: '',
      isBase64Encoded: false,
      headers: { count: 1, flag: false },
      multiValueHeaders: { x: ['one', 2, false] },
    },
  ]) {
    expect(await run(valid)).toBe(valid);
  }
});
