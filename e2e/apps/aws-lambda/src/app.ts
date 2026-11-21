import type { IncomingMessage } from 'node:http';

import { withJwt } from '@serverless-jwt/aws-lambda';
import { createServer } from 'node:http';

import { nodeCors } from '../capabilities.ts';
import { apiGatewayV1, apiGatewayV2, alb, context } from './events.ts';

/**
 * Module-scope authentication keeps the verifier cache local to this fixture application.
 */
const options = {
  /**
   * Runtime fixture issuer uses trusted HTTPS discovery.
   */
  issuer: process.env.ISSUER ?? 'https://issuer.example',

  /**
   * An API audience is distinct from every client identifier.
   */
  audience: 'https://resource.example',
  ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
};

/**
 * Preserves every wire value when translating the local HTTP bridge to AWS ingress containers.
 */
function headers(request: IncomingMessage): {
  readonly single: Record<string, string>;
  readonly multi: Record<string, string[]>;
} {
  const multi: Record<string, string[]> = {};
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]?.toLowerCase();
    if (name !== undefined) {
      (multi[name] ??= []).push(request.rawHeaders[index + 1] ?? '');
    }
  }

  return {
    multi,
    single: Object.fromEntries(
      Object.entries(multi).map(([name, values]) => [name, values.at(-1) ?? '']),
    ),
  };
}
/**
 * Each exported AWS factory is instantiated separately; Function URLs use the v2 form.
 */
const v1 = withJwt.apiGatewayV1(options, async (_event, _context, auth) => ({
  statusCode: 200,
  body: JSON.stringify({ sub: auth.claims.sub, scopes: auth.scopes }),
}));

/**
 * HTTP API preserves comma joining, including repeated authorization fields.
 */
const v2 = withJwt.apiGatewayV2(options, async (_event, _context, auth) => ({
  statusCode: 200,
  body: JSON.stringify({ sub: auth.claims.sub, scopes: auth.scopes }),
}));

/**
 * ALB multi-value is the safe default target-group configuration.
 */
const multi = withJwt.alb(options, async (_event, _context, auth) => ({
  statusCode: 200,
  body: JSON.stringify({ sub: auth.claims.sub, scopes: auth.scopes }),
}));

/**
 * Explicit single-value mode demonstrates its documented lost duplicate guarantee.
 */
const single = withJwt.alb(
  { ...options, albHeaders: 'single-value' },
  async (_event, _context, auth) => ({
    statusCode: 200,
    body: JSON.stringify({ sub: auth.claims.sub, scopes: auth.scopes }),
  }),
);
createServer(async (request, response): Promise<void> => {
  if (request.url === '/ready') {
    response.end('ready');
    return;
  }

  if (nodeCors(request, response)) {
    return;
  }

  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const values = headers(request);
  let result:
    | Awaited<ReturnType<typeof v1>>
    | Awaited<ReturnType<typeof v2>>
    | Awaited<ReturnType<typeof multi>>;
  if (pathname.endsWith('/v2')) {
    const event = apiGatewayV2();
    event.requestContext.http.method = request.method ?? 'GET';
    event.headers = Object.fromEntries(
      Object.entries(values.multi).map(([name, entries]) => [name, entries.join(', ')]),
    );
    result = await v2(event, context());
  } else if (pathname.endsWith('/alb') || pathname.endsWith('/single')) {
    const event = alb();
    event.httpMethod = request.method ?? 'GET';
    if (pathname.endsWith('/single')) {
      delete event.multiValueHeaders;
      event.headers = values.single;
      result = await single(event, context());
    } else {
      event.multiValueHeaders = values.multi;
      result = await multi(event, context());
    }
  } else {
    const event = apiGatewayV1();
    event.httpMethod = request.method ?? 'GET';
    event.headers = values.single;
    event.multiValueHeaders = values.multi;
    result = await v1(event, context());
  }

  const outputHeaders = result.headers
    ? Object.fromEntries(
        Object.entries(result.headers).map(([name, value]) => [name, String(value)]),
      )
    : Object.fromEntries(
        Object.entries(
          ('multiValueHeaders' in result ? result.multiValueHeaders : undefined) ?? {},
        ).map(([name, entries]) => [name, entries?.map(String).join(', ') ?? '']),
      );
  response.writeHead(result.statusCode ?? 200, outputHeaders);
  response.end(result.body ?? '');
}).listen(Number(process.env.PORT), '127.0.0.1');
