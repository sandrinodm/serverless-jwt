import { withJwt } from '@serverless-jwt/aws-lambda';

/**
 * Uses real container HTTPS discovery and an API audience distinct from any client ID.
 */
const options = {
  /**
   * Exact issuer advertised through the container fault proxy.
   */
  issuer: process.env.ISSUER ?? '',

  /**
   * Resource audience is distinct from any OIDC client identifier.
   */
  audience: 'https://resource.example',

  /**
   * Short real cooldown and fetch deadline keep local fault recovery bounded.
   */
  keys: { cooldown: 1, timeout: 1 },
};

/**
 * Positive-control logging is available only in deliberately isolated leaking test instances.
 */
function logControl(headers: Readonly<Record<string, string | undefined>>): void {
  if (
    process.env.E2E_LOG_CONTROL === '1' &&
    Object.entries(headers).some(
      ([name, value]) => name.toLowerCase() === 'x-e2e-log-control' && value === '1',
    )
  ) {
    console.log(
      Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1],
    );
  }
}

/**
 * Actual API Gateway REST wrapper, built from the public candidate artifact for Docker runs.
 */
const rest = withJwt.apiGatewayV1(options, async (event, _context, auth) => {
  logControl(event.headers);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'x-e2e-handler': 'verified' },
    body: JSON.stringify({ sub: auth.claims.sub, node: process.version }),
  };
});

/**
 * Actual HTTP API/Function URL wrapper retains comma-joined duplicate credentials.
 */
const http = withJwt.apiGatewayV2(options, async (event, _context, auth) => {
  logControl(event.headers);

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'x-e2e-handler': 'verified' },
    body: JSON.stringify({ sub: auth.claims.sub, node: process.version }),
  };
});

/**
 * Native application CORS is explicit and operates on the original event headers/query containers.
 */
function corsEnabled(
  headers: Readonly<Record<string, string | undefined>>,
  query: Readonly<Record<string, string | undefined>> | null | undefined,
): boolean {
  return (
    query?.e2e_cors === '1' &&
    Object.entries(headers).some(
      ([name, value]) => name.toLowerCase() === 'origin' && value === 'https://cors.example',
    )
  );
}

/**
 * Recognized preflights return before either verifier or protected handler is invoked.
 */
function isPreflight(
  method: string,
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    method === 'OPTIONS' &&
    Object.entries(headers).some(
      ([name, value]) => name.toLowerCase() === 'access-control-request-method' && value === 'GET',
    )
  );
}

/**
 * App-owned preflight headers contain no auth state and never turn protected GET into a bypass.
 */
const corsHeaders = {
  /**
   * Fixed origin accepted only by the explicit test-app preflight path.
   */
  'access-control-allow-origin': 'https://cors.example',

  /**
   * The opted-in preflight permits the guarded GET fixture only.
   */
  'access-control-allow-methods': 'GET',

  /**
   * Observable ordering marker proves app CORS ran before the guard.
   */
  'x-e2e-cors': 'before-guard',
};

/**
 * Readiness and deliberate app CORS never touch the verifier's initially cold cache.
 */
export const v1: typeof rest = async (event, context) => {
  if (event.path === '/ready') {
    return { statusCode: 200, body: 'ready' };
  }

  const cors = corsEnabled(event.headers, event.queryStringParameters);
  if (cors && isPreflight(event.httpMethod, event.headers)) {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const result = await rest(event, context);
  return cors
    ? {
        ...result,
        headers: { ...result.headers, 'access-control-allow-origin': 'https://cors.example' },
      }
    : result;
};

/**
 * HTTP API uses the same explicit app CORS around its separate original native wrapper.
 */
export const v2: typeof http = async (event, context) => {
  if (event.rawPath === '/ready') {
    return { statusCode: 200, body: 'ready' };
  }

  const cors = corsEnabled(event.headers, event.queryStringParameters);
  if (cors && isPreflight(event.requestContext.http.method, event.headers)) {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const result = await http(event, context);
  return cors && typeof result !== 'string'
    ? {
        ...result,
        headers: { ...result.headers, 'access-control-allow-origin': 'https://cors.example' },
      }
    : result;
};

/**
 * Native emulator control omits authentication entirely to classify cold-start infrastructure
 * failures.
 */
export async function nativeControl(event: {
  readonly headers?: Readonly<Record<string, string | undefined>>;
}): Promise<{
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}> {
  const subject = Object.entries(event.headers ?? {}).find(
    ([name]) => name.toLowerCase() === 'x-capacity-sub',
  )?.[1];
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'x-e2e-handler': 'verified' },
    body: JSON.stringify({ sub: subject, node: process.version }),
  };
}
