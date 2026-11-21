import {
  createJwtVerifier,
  getBearerToken,
  JwtVerifierError,
  requireScopes,
} from '@serverless-jwt/jwt-verifier';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { connect } from 'node:net';

/**
 * Starts an ephemeral loopback-only server and returns its origin without exposing credentials.
 */
async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

/**
 * Closes listeners and their keep-alive sockets after positive or negative evidence.
 */
async function close(server) {
  const closed = new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  server.closeAllConnections();
  await closed;
}

/**
 * Creates an ephemeral signing key so the standalone example needs no provider credentials.
 */
const pair = await generateKeyPair('RS256');
/**
 * Publishes only the example public key with the metadata needed for JWKS selection.
 */
const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'RS256', use: 'sig', kid: 'local-only' };
/**
 * Serves loopback discovery and JWKS using the generated public key.
 */
const issuerServer = createServer((request, response) => {
  if (request.url !== '/jwks') {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ keys: [jwk] }));
});
/**
 * Allows an explicit issuer port while defaulting to a free operating-system port.
 */
const issuerPort = Number(process.env.ISSUER_PORT ?? 0);
assert.ok(Number.isInteger(issuerPort) && issuerPort >= 0 && issuerPort <= 65535);
/**
 * Retains the actual listening issuer URL for token claims and verifier configuration.
 */
const issuer = await listen(issuerServer, issuerPort);
/**
 * Tracks the protected example server so cleanup also runs after a failed assertion.
 */
let app;
try {
  const verifier = createJwtVerifier({
    issuer,
    audience: 'urn:example:orders-api',
    algorithms: ['RS256'],
    jwksUri: `${issuer}/jwks`,
    discovery: false,
    allowInsecureLocalhost: true,
    mapClaims: (claims) => ({ userId: claims.sub }),
  });
  app = createServer(async (request, response) => {
    try {
      const bearer = getBearerToken(request.headersDistinct.authorization);
      if (!bearer.ok) {
        throw new JwtVerifierError(bearer.reason);
      }

      const auth = await verifier.verify(bearer.token);
      requireScopes(auth, ['read:orders']);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(
        JSON.stringify({ identity: auth.identity, subject: auth.claims.sub, scopes: auth.scopes }),
      );
    } catch (error) {
      if (!(error instanceof JwtVerifierError)) {
        response.writeHead(500, { 'cache-control': 'no-store' }).end();
        return;
      }

      const http = error.toHttp();
      response.writeHead(http.status, http.headers);
      response.end(JSON.stringify(http.body));
    }
  });
  const localApp = await listen(app);
  /**
   * Uses public jose APIs with fresh disposable keys; these are not provider-issued credentials.
   */
  const mint = (scope) =>
    new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience('urn:example:orders-api')
      .setSubject('local-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey);
  const valid = await mint('read:orders');
  /**
   * Sends literal HTTP headers so Node cannot normalize away a duplicate credential in this gate.
   */
  const duplicate = (values) =>
    new Promise((resolve, reject) => {
      const target = new URL(localApp);
      const socket = connect({ host: target.hostname, port: Number(target.port) });
      let text = '';
      socket.setEncoding('utf8');
      socket.setTimeout(2000, () =>
        socket.destroy(new Error('Duplicate-header request timed out')),
      );
      socket.on('error', reject);
      socket.on('data', (chunk) => {
        text += chunk;
      });
      socket.on('end', () => resolve(text));
      socket.on('connect', () =>
        socket.write(
          [
            'GET / HTTP/1.1',
            `Host: ${target.host}`,
            'Connection: close',
            ...values.map((value) => `Authorization: Bearer ${value}`),
            '',
            '',
          ].join('\r\n'),
        ),
      );
    });
  for (const values of [
    [valid, 'invalid'],
    ['invalid', valid],
  ]) {
    const response = await duplicate(values);
    assert.match(response, /^HTTP\/1\.1 400 /);
    assert.match(response, /\r\nwww-authenticate: Bearer error="invalid_request"\r\n/i);
    assert.match(response, /\r\ncache-control: no-store\r\n/i);
    const body = JSON.stringify({
      error: 'invalid_request',
      error_description: 'Multiple credentials are not allowed.',
    });
    const payload = response.slice(response.indexOf('\r\n\r\n') + 4);
    assert.equal(payload, `${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n0\r\n\r\n`);
    assert.ok(!response.includes(valid));
    assert.ok(!response.includes('Bearer invalid'));
  }

  const allowed = await fetch(localApp, { headers: { authorization: `Bearer ${valid}` } });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), {
    identity: { userId: 'local-user' },
    subject: 'local-user',
    scopes: ['read:orders'],
  });
  const missing = await fetch(localApp);
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer realm="api"');
  const invalid = await fetch(localApp, { headers: { authorization: 'Bearer invalid' } });
  assert.equal(invalid.status, 401);
  const insufficient = await fetch(localApp, {
    headers: { authorization: `Bearer ${await mint('write:orders')}` },
  });
  assert.equal(insufficient.status, 403);
  for (const response of [missing, invalid, insufficient]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.arrayBuffer();
  }

  // An external app must be configured for this issuer/JWKS, audience and scope before starting.
  if (process.env.TARGET_URL) {
    const target = new URL(process.env.TARGET_URL);
    assert.ok(
      ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname),
      'TARGET_URL must be loopback',
    );
    assert.ok(['http:', 'https:'].includes(target.protocol));
    const result = await fetch(target, {
      headers: { authorization: `Bearer ${valid}` },
      redirect: 'error',
    });
    assert.equal(result.status, 200, 'Configured local app rejected the local access token');
    await result.arrayBuffer();
  }

  console.log(
    'Verified local JWKS: valid 200, missing/invalid 401, insufficient scope 403, duplicate credentials 400, mapped identity preserved.',
  );
} finally {
  if (app) {
    await close(app);
  }

  await close(issuerServer);
}
