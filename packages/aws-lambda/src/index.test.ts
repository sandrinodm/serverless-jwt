import type {
  ALBResult,
  APIGatewayProxyResult,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

import { JwtVerifierError } from '@serverless-jwt/jwt-verifier';
import { expect, it } from 'vite-plus/test';

import { apiGatewayV1, apiGatewayV2, alb, context } from '../../testkit/fixtures/aws/events.ts';
import { withJwt } from './index.ts';

/**
 * Minimal valid policy rejects before remote verification in every configuration probe.
 */
const policy = { issuer: 'https://issuer.example', audience: 'api' };

it('fails closed without ALB multi-value configuration and uses only the selected response container', async () => {
  let called = false;
  const event = alb();
  delete event.multiValueHeaders;
  const multi = await withJwt.alb(policy, async () => {
    called = true;
    return { statusCode: 200, body: '' };
  })(event, context());
  expect(multi.statusCode).toBe(500);
  expect(multi.headers).toBeUndefined();
  expect(multi.multiValueHeaders?.['cache-control']).toEqual(['no-store']);
  const single = await withJwt.alb({ ...policy, albHeaders: 'single-value' }, async () => ({
    statusCode: 200,
    body: '',
  }))(event, context());
  expect(single.statusCode).toBe(401);
  expect(single.multiValueHeaders).toBeUndefined();
  expect(single.headers?.['cache-control']).toBe('no-store');
  expect(called).toBe(false);
});

it('reads ordinary ALB headers from the selected request container', async () => {
  const event = alb();
  event.multiValueHeaders = {
    'X-Probe': ['one'],
    'x-probe': ['two'],
    'x-empty': [],
    'x-optional': undefined,
    'x-blank': [''],
  };
  const wrapped = withJwt.alb(
    {
      ...policy,
      skip: (view) => {
        expect(view.header('X-Empty')).toBeUndefined();
        expect(view.header('x-optional')).toBeUndefined();
        expect(view.header('x-blank')).toBe('');
        expect(view.header('x-single-only')).toBeUndefined();
        return view.header('x-probe') === 'one, two';
      },
    },
    async (_event, _context, auth) => {
      expect(auth).toBeUndefined();
      return { statusCode: 200, body: 'skipped' };
    },
  );
  expect((await wrapped(event, context())).body).toBe('skipped');
  event.headers = { 'x-probe': 'wrong', 'x-single-only': 'ignored' };
  expect((await wrapped(event, context())).body).toBe('skipped');
});

it('allows single-value ALB skip policies to inspect an event without headers', async () => {
  const event = alb();
  event.multiValueHeaders = undefined;
  const wrapped = withJwt.alb(
    {
      ...policy,
      albHeaders: 'single-value',
      skip: (view) => view.header('x-probe') === undefined,
    },
    async () => ({ statusCode: 200 }),
  );
  expect((await wrapped(event, context())).statusCode).toBe(200);
});

it('forwards exact SDK event/context identities, bodies and platform fields without mutation', async () => {
  for (const [event, factory] of [
    [apiGatewayV1(), withJwt.apiGatewayV1],
    [apiGatewayV2(), withJwt.apiGatewayV2],
    [alb(), withJwt.alb],
  ] as const) {
    const originalContext = context();
    const original = JSON.stringify(event);
    const result = { statusCode: 202, body: 'original-result' };
    // Each concrete factory is separately covered by assignability tests; here only invocation identity differs.
    const invoke = factory as typeof withJwt.apiGatewayV1;
    const wrapped = invoke(
      { ...policy, skip: () => true },
      async (passedEvent, passedContext, auth) => {
        expect(passedEvent).toBe(event);
        expect(passedContext).toBe(originalContext);
        expect(auth).toBeUndefined();
        return result;
      },
    );
    expect(await wrapped(event as ReturnType<typeof apiGatewayV1>, originalContext)).toBe(result);
    expect(JSON.stringify(event)).toBe(original);
  }
});

it('fails malformed cancellation callbacks closed, observes invalid thenables and preserves hook context', async () => {
  const errors: unknown[] = [];
  const diagnostics: unknown[] = [];
  const event = apiGatewayV1();
  const ctx = context();
  for (const callback of [
    () => {
      throw 'private';
    },
    () => true,
    () => Promise.reject('private'),
    // oxlint-disable-next-line unicorn/no-thenable -- Explicit hostile thenable verifies rejection isolation without awaiting it.
    () => Object.defineProperty({}, 'then', { value: () => {} }),
  ]) {
    const wrapped = withJwt.apiGatewayV1(
      {
        ...policy,
        getSignal: callback as unknown as () => AbortSignal,
        onIntegrationDiagnostic: (event) => diagnostics.push(event),
        onError: (error, passed, passedContext) => {
          errors.push(error.reason);
          expect(passed).toBe(event);
          expect(passedContext).toBe(ctx);
          return undefined;
        },
      },
      async () => ({ statusCode: 200, body: '' }),
    );
    const result = await wrapped(event, ctx);
    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('private');
  }

  expect(errors).toEqual(Array.from({ length: 4 }, () => 'adapter_misconfigured'));
  expect(diagnostics).toEqual(
    Array.from({ length: 4 }, () => ({ type: 'integration.adapter_misconfigured' })),
  );
});

it('validates factory callbacks and ALB mode before constructing an adapter', () => {
  expect(() =>
    withJwt.apiGatewayV1(
      { ...policy, getSignal: 42 as unknown as () => AbortSignal },
      async () => ({ statusCode: 200, body: '' }),
    ),
  ).toThrow(JwtVerifierError);
  expect(() =>
    withJwt.alb({ ...policy, albHeaders: 'unexpected' as 'single-value' }, async () => ({
      statusCode: 200,
      body: '',
    })),
  ).toThrow(JwtVerifierError);
});

it('reads original case-insensitive named headers and rejects unusable custom result shapes', async () => {
  const event = apiGatewayV1();
  event.headers = { 'X-Probe': 'present' };
  const skipped = withJwt.apiGatewayV1(
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
  expect((await skipped(event, context())).body).toBe('skipped');
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
    const wrapped = withJwt.apiGatewayV1(
      { ...policy, onError: () => invalid as { statusCode: number; body: string } },
      async () => ({ statusCode: 200, body: '' }),
    );
    expect((await wrapped(event, context())).statusCode).toBe(401);
  }

  const withoutBody = withJwt.apiGatewayV2(
    { ...policy, onError: () => ({ statusCode: 418 }) },
    async () => ({ statusCode: 200 }),
  );
  expect((await withoutBody(apiGatewayV2(), context())).statusCode).toBe(418);
});

it('emits one fixed configuration diagnostic for ALB misconfiguration even with an existing verifier', async () => {
  const { createJwtVerifier } = await import('@serverless-jwt/jwt-verifier');
  const event = alb();
  delete event.multiValueHeaders;
  for (const failure of ['none', 'throw', 'reject'] as const) {
    const events: unknown[] = [];
    const wrapped = withJwt.alb(
      {
        verifier: createJwtVerifier(policy),
        onIntegrationDiagnostic: (diagnostic) => {
          expect(Object.isFrozen(diagnostic)).toBe(true);
          events.push(diagnostic);
          if (failure === 'throw') {
            throw 'private';
          }

          if (failure === 'reject') {
            return Promise.reject('private');
          }

          return undefined;
        },
      },
      async () => ({ statusCode: 200, body: '' }),
    );
    const result = await wrapped(event, context());
    expect(result.statusCode).toBe(500);
    expect(events).toEqual([{ type: 'integration.adapter_misconfigured' }]);
    expect(result.body).not.toContain('private');
  }
});

it('validates native JavaScript error-hook results per ingress while preserving valid SDK forms', async () => {
  const shapes = [
    {
      name: 'v1',
      run: (value: unknown) =>
        withJwt.apiGatewayV1(
          { ...policy, onError: () => value as APIGatewayProxyResult },
          async () => ({ statusCode: 200, body: '' }),
        )(apiGatewayV1(), context()),
    },
    {
      name: 'v2',
      run: (value: unknown) =>
        withJwt.apiGatewayV2(
          {
            ...policy,
            onError: () => value as APIGatewayProxyStructuredResultV2,
          },
          async () => ({ statusCode: 200 }),
        )(apiGatewayV2(), context()),
    },
    {
      name: 'multi',
      run: (value: unknown) =>
        withJwt.alb({ ...policy, onError: () => value as ALBResult }, async () => ({
          statusCode: 200,
        }))(alb(), context()),
    },
    {
      name: 'single',
      run: (value: unknown) =>
        withJwt.alb(
          {
            ...policy,
            albHeaders: 'single-value',
            onError: () => value as ALBResult,
          },
          async () => ({ statusCode: 200 }),
        )(alb(), context()),
    },
  ] as const;
  for (const shape of shapes) {
    for (const invalid of [
      null,
      false,
      42,
      [],
      { statusCode: '418', body: '' },
      { statusCode: 418.5, body: '' },
      { statusCode: 99, body: '' },
      { statusCode: 600, body: '' },
      { statusCode: 418, body: {} },
      { statusCode: 418, body: '', isBase64Encoded: 'true' },
      { statusCode: 418, body: '', headers: 'bad' },
      { statusCode: 418, body: '', headers: [] },
      { statusCode: 418, body: '', headers: { 'bad name': 'x' } },
      { statusCode: 418, body: '', headers: { x: 'one\r\ntwo' } },
      { statusCode: 418, body: '', headers: { x: NaN } },
      { statusCode: 418, body: '', multiValueHeaders: 'bad' },
      { statusCode: 418, body: '', multiValueHeaders: { x: 'bad' } },
      { statusCode: 418, body: '', multiValueHeaders: { x: [{}] } },
      { statusCode: 418, body: '', cookies: 42 },
    ]) {
      expect((await shape.run(invalid)).statusCode, shape.name).toBe(401);
    }

    const valid = {
      statusCode: 418,
      body: '',
      isBase64Encoded: false,
      ...(shape.name === 'multi'
        ? { multiValueHeaders: { x: ['one', 'two'] } }
        : { headers: { x: 'one' } }),
    };
    expect(await shape.run(valid), shape.name).toBe(valid);
  }

  expect((await shapes[0].run({ statusCode: 418 })).statusCode).toBe(401);
  for (const valid of [
    {},
    { body: 'native default 200' },
    { statusCode: 418 },
    {
      statusCode: 418,
      cookies: ['session=a; Path=/'],
      headers: { text: 'one', count: 1, flag: false },
    },
  ]) {
    expect(await shapes[1].run(valid)).toBe(valid);
  }

  for (const invalid of [
    { statusCode: 418, multiValueHeaders: { x: ['one'] } },
    { statusCode: 418, cookies: [42] },
    { statusCode: 418, cookies: ['one\ntwo'] },
  ]) {
    expect((await shapes[1].run(invalid)).statusCode).toBe(401);
  }

  for (const invalid of [
    { statusCode: 418, headers: { x: 'one' } },
    { statusCode: 418, multiValueHeaders: { x: [false] } },
    { statusCode: 418, statusDescription: 42 },
    { statusCode: 418, statusDescription: 'bad\nvalue' },
  ]) {
    expect((await shapes[2].run(invalid)).statusCode).toBe(401);
  }

  expect(
    (await shapes[3].run({ statusCode: 418, multiValueHeaders: { x: ['one'] } })).statusCode,
  ).toBe(401);
  for (const index of [2, 3] as const) {
    const valid = { statusCode: 418, statusDescription: "418 I'm a teapot" };
    expect(await shapes[index].run(valid)).toBe(valid);
  }

  const v1 = {
    statusCode: 418,
    body: '',
    headers: { count: 1, flag: false },
    multiValueHeaders: { x: ['one', 2, false] },
  };
  expect(await shapes[0].run(v1)).toBe(v1);
});
