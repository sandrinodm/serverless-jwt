import type { IncomingMessage } from 'node:http';

import { withJwt } from '@serverless-jwt/netlify/v1';
import { createServer } from 'node:http';

import { nodeCors } from '../capabilities.ts';
import { apiGatewayV1, context } from './events.ts';

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
 * Transitional v1 handlers receive auth explicitly and retain Netlify-owned clientContext.
 */
// oxlint-disable-next-line typescript/no-deprecated -- Required transitional example.
const handler = withJwt(options, async (_event, originalContext, auth) => ({
  statusCode: 200,
  body: JSON.stringify({
    sub: auth.claims.sub,
    scopes: auth.scopes,
    platform: originalContext.clientContext?.platform,
  }),
}));
createServer(async (request, response): Promise<void> => {
  if (request.url === '/ready') {
    response.end('ready');
    return;
  }

  if (nodeCors(request, response)) {
    return;
  }

  const values = headers(request);
  const event = {
    ...apiGatewayV1(),
    httpMethod: request.method ?? 'GET',
    headers: values.single,
    multiValueHeaders: values.multi,
    rawUrl: 'http://localhost' + request.url,
    rawQuery: '',
  };
  const { identity: _identity, clientContext: _clientContext, ...nativeContext } = context();
  const result = await handler(event, {
    ...nativeContext,
    clientContext: { platform: 'original' },
  });
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
