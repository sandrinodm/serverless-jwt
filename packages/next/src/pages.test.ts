import type { NextApiRequest, NextApiResponse } from 'next';

import { createMocks } from 'node-mocks-http';
import { expect, it } from 'vite-plus/test';

import type { CancellationSetup } from '../../testkit/src/conformance/node-cancellation.spec.ts';

import { withJwtPages } from './pages.ts';

it('keeps committed Pages responses and rethrows hook failures without another write', async () => {
  for (const fail of [false, true]) {
    const cause = new Error('hook failure');
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>();
    const events: unknown[] = [];
    const wrapped = withJwtPages(
      {
        issuer: 'https://issuer.example',
        audience: 'api',
        onIntegrationDiagnostic: (event) => events.push(event),
        onError: (_error, original, response) => {
          expect(original).toBe(req);
          expect(response).toBe(res);
          response.status(418).end('committed');
          if (fail) {
            throw cause;
          }
        },
      },
      () => {
        throw new Error('Unreachable');
      },
    );
    const outcome = await wrapped(req, res).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBe(fail ? cause : undefined);
    expect(res.statusCode).toBe(418);
    expect(res._getData()).toBe('committed');
    expect(events).toHaveLength(fail ? 1 : 0);
  }
});

it('validates hook values, default request fields and the original named header view', async () => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    headers: { 'x-probe': ['one', 'two'] },
  });
  delete req.method;
  delete req.url;
  const skip = withJwtPages(
    {
      issuer: 'https://issuer.example',
      audience: 'api',
      skip: (view) => {
        expect(view.method).toBe('GET');
        expect(view.url).toBe('/');
        expect(view.header('x-probe')).toBe('one, two');
        expect(view.header('absent')).toBeUndefined();
        return true;
      },
    },
    (request, response, auth) => {
      expect(request).toBe(req);
      expect(auth).toBeUndefined();
      response.end('skipped');
    },
  );
  await skip(req, res);
  expect(res._getData()).toBe('skipped');
  const other = createMocks<NextApiRequest, NextApiResponse>();
  await withJwtPages(
    { issuer: 'https://issuer.example', audience: 'api', onError: () => 42 as unknown as void },
    () => {},
  )(other.req, other.res);
  expect(other.res.statusCode).toBe(401);
});

it('cancels after Next body parsing on physical disconnect while preserving a shared waiter', async () => {
  const { exerciseCompletedBodyDisconnect, exercisePreclosedResponse, exerciseFinishedResponse } =
    await import('../../testkit/src/conformance/node-cancellation.spec.ts');
  const { listen } = await import('../../testkit/src/conformance/node-wire.ts');
  const { createServer } = await import('node:http');
  const { apiResolver } = await import('next/dist/server/api-utils/node/api-resolver.js');
  const setup: CancellationSetup = async (options, observe, settled, handler) => {
    const wrapped = withJwtPages(options, async (request, response) => {
      handler(request, response);
    });
    const module = {
      config: { api: { externalResolver: true } },
      default: async (request: NextApiRequest, response: NextApiResponse): Promise<void> => {
        expect(request.body).toBe('body');
        await observe(request, response);
        try {
          await wrapped(request, response);
        } finally {
          settled(request, response);
        }
      },
    };
    const server = await listen(
      createServer((request, response) => {
        void apiResolver(
          request,
          response,
          {},
          module,
          {
            dev: false,
            previewModeId: 'fixture',
            previewModeEncryptionKey: '0'.repeat(32),
            previewModeSigningKey: '1'.repeat(32),
          },
          true,
          false,
          '/protected',
        );
      }),
    );
    return { port: server.port, close: () => server[Symbol.asyncDispose]() };
  };
  const result = await exerciseCompletedBodyDisconnect(setup);
  expect(await exercisePreclosedResponse(setup)).toEqual({ verifyCalls: 0 });
  expect(await exerciseFinishedResponse(setup)).toEqual({ aborted: false });
  expect(result).toEqual({ fetches: 1, handlers: ['second'] });
});
