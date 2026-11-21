import assert from 'node:assert/strict';

import type { startFaultProxy } from '../harness/src/toxiproxy.docker.ts';
import type { CapabilityRow } from '../matrix.ts';

import { fixtureKey } from '../../packages/testkit/src/keys.ts';
import { mintToken } from '../../packages/testkit/src/tokens.ts';
import { securitySuite } from './security.ts';

/**
 * Pre-mints the complete immutable registry before high-volume fingerprint-only log capture begins.
 */
export async function lambdaCredentials(issuer: string): Promise<{
  readonly tokens: ReadonlyArray<string>;
  readonly credentials: ReadonlyArray<string>;
  readonly subjects: ReadonlyArray<string>;
  readonly smoke: string;
  readonly expired: string;
  readonly wrong: string;
  readonly rotated: Readonly<Record<string, string>>;
}> {
  const tokens: string[] = [];
  /**
   * Uses real RSA signatures and broad clock margins; no token contents reach test diagnostics.
   */
  const mint = async (
    sub: string,
    exp: number,
    aud = 'https://resource.example',
    kid?: string,
  ): Promise<string> => {
    const token = await mintToken({
      key: fixtureKey(2048),
      header: kid ? { kid } : {},
      payload: { iss: issuer, aud, sub, exp },
    });
    tokens.push(token);
    return token;
  };
  const now = Math.floor(Date.now() / 1000);
  const subjects = Array.from({ length: 200 }, (_, index) => 'lambda-' + index);
  const credentials = await Promise.all(subjects.map((subject) => mint(subject, now + 900)));
  const smoke = await mint('lambda-smoke', now + 300);
  const expired = await mint('lambda-expired', now - 3600);
  const wrong = await mint('lambda-wrong', now + 900, 'private-wrong-audience');
  const rotated = Object.fromEntries(
    await Promise.all(
      ['v1', 'v2'].map(async (shape) => [
        shape,
        await mint('lambda-rotated', now + 900, 'https://resource.example', 'rotated-' + shape),
      ]),
    ),
  );
  return { tokens, credentials, subjects, smoke, expired, wrong, rotated };
}

/**
 * Runs actual ingress isolation/security, wide-margin clocks and cache-aware TCP outage recovery.
 */
export async function lambdaSecurity(options: {
  readonly row: CapabilityRow;
  readonly baseURL: string;
  readonly credentials: Awaited<ReturnType<typeof lambdaCredentials>>;
  readonly proxy: Awaited<ReturnType<typeof startFaultProxy>>;
  readonly shape: 'v1' | 'v2';
}): Promise<void> {
  const { row, credentials, proxy } = options;
  await securitySuite({
    row,
    url: options.baseURL,
    tokens: credentials.credentials,
    subjects: credentials.subjects,
  });
  const url = options.baseURL + row.route;
  /**
   * Drains public JSON results while retaining only statuses and verified noncredential fields.
   */
  const request = async (token: string): Promise<Response> =>
    fetch(url, { headers: { authorization: 'Bearer ' + token } });
  const valid = await request(credentials.smoke);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { sub: 'lambda-smoke', node: 'v24.22.2' });
  for (const token of [credentials.expired, credentials.wrong]) {
    const response = await request(token);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!(await response.text()).includes('private-wrong-audience'));
  }

  const before = proxy.counts().requests;
  const remove = await proxy.toxic('reset_peer', { timeout: 0 });
  const rotated = credentials.rotated[options.shape];
  assert.ok(rotated);
  try {
    // Fresh cache contains this known key; a transport outage performs zero issuer requests.
    const fresh = await request(credentials.smoke);
    assert.equal(fresh.status, 200);
    await fresh.arrayBuffer();
    assert.equal(proxy.counts().requests, before);
    await new Promise<void>((resolve) => setTimeout(resolve, 1_150));
    // Unknown key, cooldown over, no stale allowance: a fetch-needed outage must return503.
    const failed = await request(rotated);
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get('retry-after'), '1');
    await failed.arrayBuffer();
    assert.equal(proxy.counts().requests, before);
  } finally {
    await remove();
  }

  proxy.rotate('rotated-' + options.shape);
  await new Promise<void>((resolve) => setTimeout(resolve, 1_150));
  const recovered = await request(rotated);
  assert.equal(recovered.status, 200);
  await recovered.arrayBuffer();
  assert.equal(proxy.counts().requests, before + 1);
}
