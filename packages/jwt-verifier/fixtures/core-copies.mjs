import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, readFileSync, readdirSync } from 'node:fs';

import * as own from '@serverless-jwt/jwt-verifier';
import { createGuard } from '@serverless-jwt/jwt-verifier/adapter';

/**
 * Installs a second physical tree from the exact installed tarball, without changing its bytes.
 */
const primary = new URL('./node_modules/@serverless-jwt/jwt-verifier/', import.meta.url);
/**
 * Keeps the second copy beside the first so both resolve the same installed jose dependency.
 */
const duplicate = new URL('./node_modules/@serverless-jwt/jwt-verifier-second/', import.meta.url);
cpSync(primary, duplicate, { recursive: true });
for (const file of readdirSync(new URL('dist/', primary), { recursive: true }).filter((name) => /\.(mjs|mts)$/.test(name))) {
  assert.equal(
    createHash('sha256').update(readFileSync(new URL(`dist/${file}`, primary))).digest('hex'),
    createHash('sha256').update(readFileSync(new URL(`dist/${file}`, duplicate))).digest('hex'),
  );
}

/**
 * Loads distinct constructors from identical package artifacts.
 */
const second = await import(new URL('dist/index.mjs', duplicate));
assert.notEqual(own.JwtVerifierError, second.JwtVerifierError);
/**
 * Uses an actual cryptographic signing identity, never synthetic verifier return values.
 */
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
/**
 * Advertises only the matching public RSA key to the injected local JWKS transport.
 */
const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
/**
 * Pins claim and cache time independently for every verifier instance.
 */
const epoch = 1_700_000_000;
/**
 * Mints real signed credentials without including them in assertion output or logs.
 */
function mint(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'https://issuer.test', aud: 'api', sub: 'subject', scope: 'read', exp: epoch + 300, ...claims })).toString('base64url');
  const input = `${header}.${body}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key.privateKey).toString('base64url')}`;
}
/**
 * Constructs the actual integration request while keeping credentials out of assertion diagnostics.
 */
function request(token) {
  return { method: 'GET', url: 'https://api.test', authorization: [`Bearer ${token}`], header: () => undefined };
}
/**
 * Compares complete canonical rejections and proves no rejected request reaches application code.
 */
async function rejection(guard, token, reason, options = {}) {
  let handled = false;
  const result = await guard.decide(request(token));
  if (result.kind === 'continue') {
    handled = true;
  }

  assert.equal(handled, false);
  assert.equal(result.kind, 'reject');
  assert.ok(result.error instanceof own.JwtVerifierError);
  assert.equal(result.error.reason, reason);
  assert.deepEqual(result.http, new own.JwtVerifierError(reason, options).toHttp());
  return result;
}

for (const module of [own, second]) {
  let fetches = 0;
  const config = { issuer: 'https://issuer.test', audience: 'api', jwksUri: 'https://issuer.test/jwks', clock: { now: () => epoch * 1000 }, fetch: async () => {
    fetches++;
    return Response.json({ keys: [jwk] });
  } };
  const verifier = module.createJwtVerifier(config);
  const guard = createGuard({ verifier, scopes: ['read'] });
  await rejection(guard, 'a.b.c', 'malformed_token');
  assert.equal(fetches, 0);
  await rejection(guard, mint({ exp: epoch - 100 }), 'token_expired');
  await rejection(guard, mint({ aud: 'other' }), 'claim_audience');
  const valid = mint();
  const accepted = await guard.decide(request(valid));
  assert.equal(accepted.kind, 'continue');
  assert.equal(accepted.auth.claims.sub, 'subject');
  assert.equal(accepted.auth.token === valid, true);
  assert.equal(fetches, 1);
  await rejection(createGuard({ verifier, scopes: ['admin'] }), valid, 'insufficient_scope', { scopes: ['admin'] });
  const missing = await guard.decide({ ...request(valid), authorization: [] });
  assert.equal(missing.kind, 'reject');
  assert.equal(missing.http.headers['www-authenticate'], 'Bearer realm="api"');
  const otherPolicy = module.createJwtVerifier({ ...config, audience: 'other' });
  await rejection(createGuard({ verifier: otherPolicy }), valid, 'claim_audience');
  assert.equal(fetches, 2);

  let time = epoch * 1000;
  let failures = 0;
  const outage = module.createJwtVerifier({ ...config, clock: { now: () => time }, fetch: async () => { failures++; throw new Error('private-outage-detail'); } });
  const unavailable = createGuard({ verifier: outage });
  const random = Math.random;
  Math.random = () => 0.99;
  try {
    for (const retryAfter of [1, 2, 4, 8, 16, 30]) {
      const result = await rejection(unavailable, valid, 'jwks_unavailable', { retryAfter });
      assert.equal(Number(result.http.headers['retry-after']), retryAfter);
      await rejection(unavailable, valid, 'jwks_unavailable', { retryAfter });
      time += 31_000;
    }
  } finally {
    Math.random = random;
  }

  assert.equal(failures, 6);
  assert.equal((await guard.decide(request(valid))).kind, 'continue');
  assert.equal(fetches, 2);
}
console.log('Verified identical installed core copies: cryptographic claims, scopes, isolation and retry bounds.');
