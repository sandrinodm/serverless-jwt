import assert from 'node:assert/strict';
import { connect } from 'node:net';

import type { CapabilityRow } from '../matrix.ts';

/**
 * Sends distinct wire lines in their original order, with a deadline and no fetch header joining.
 */
export async function duplicateStatus(
  url: string,
  values: ReadonlyArray<string>,
  headers: Readonly<Record<string, string>> = {},
): Promise<number> {
  const target = new URL(url);
  return new Promise<number>((resolve, reject) => {
    const socket = connect(Number(target.port), target.hostname);
    let head = '';
    socket.setTimeout(5_000, () => socket.destroy(new Error('Raw ingress request timed out')));
    socket.once('error', reject);
    socket.once('connect', () =>
      socket.write(
        'GET ' +
          target.pathname +
          target.search +
          ' HTTP/1.1\r\nHost: ' +
          target.host +
          '\r\n' +
          Object.entries(headers)
            .map(([name, value]) => name + ': ' + value + '\r\n')
            .join('') +
          values.map((value) => 'Authorization: Bearer ' + value + '\r\n').join('') +
          'Connection: close\r\n\r\n',
      ),
    );
    socket.on('data', (chunk: Buffer) => {
      head += chunk.toString('latin1');
      const line = head.indexOf('\r\n');
      if (line >= 0) {
        const match = /^HTTP\/1\.[01] (\d{3})/.exec(head.slice(0, line));
        socket.destroy();
        if (!match) {
          reject(new Error('Malformed raw HTTP response'));
        } else {
          resolve(Number(match[1]));
        }
      }
    });
    socket.once('end', () => {
      if (!head.includes('\r\n')) {
        reject(new Error('Raw HTTP response ended without status'));
      }
    });
  });
}

/**
 * Asserts complete fixed rejection output without token, claim or upstream diagnostic disclosure.
 */
export async function publicRejection(response: Response, status: number): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ['error', 'error_description']);
  assert.equal(body.error, status === 400 ? 'invalid_request' : 'invalid_token');
}

/**
 * Runs raw headers, ignored alternate credentials, forged preflight and cold/warm isolation.
 */
export async function securitySuite(options: {
  readonly row: CapabilityRow;
  readonly url: string;
  readonly tokens: ReadonlyArray<string>;
  readonly subjects: ReadonlyArray<string>;
  readonly headers?: Readonly<Record<string, string>>;
}): Promise<void> {
  const { row, tokens, subjects } = options;
  assert.notEqual(
    row.streaming,
    'preparation-only',
    'HTTP security checks require an HTTP capability',
  );
  assert.notEqual(
    row.duplicates,
    null,
    'HTTP capabilities require explicit duplicate-header statuses',
  );
  /**
   * Bounds every real request and streamed-body wait without retrying or changing transport data.
   */
  const fetch = (input: string, init?: RequestInit): Promise<Response> =>
    globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
  const url = options.url + row.route;
  const protocol = options.headers ?? {};
  assert.equal(tokens.length, 200, 'Isolation must execute exactly 200 distinct identities');
  assert.equal(new Set(subjects).size, 200);
  const first = tokens[0];
  assert.ok(first);
  // First authenticated requests form the concurrent cold round, without auth prewarming.
  // A request-scoped native dev host records cacheReason; its second round remains cold.
  for (let round = 0; round < 2; round++) {
    await Promise.all(
      tokens.map(async (token, index) => {
        const response = await fetch(url, {
          headers: { ...protocol, authorization: 'Bearer ' + token },
        });
        assert.equal(response.status, 200);
        const body = (await response.json()) as Readonly<Record<string, unknown>>;
        assert.ok(
          body[row.subjectField ?? 'sub'] === subjects[index],
          'Runtime response must echo only its own verified subject',
        );
      }),
    );
  }

  for (const headers of [
    { aUtHoRiZaTiOn: 'Bearer ' + first },
    { authorization: 'bearer ' + first },
    { authorization: 'Bearer    ' + first },
  ]) {
    const response = await fetch(url, { headers: { ...protocol, ...headers } });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }

  for (const input of [url + '?access_token=' + encodeURIComponent(first), url]) {
    const response = await fetch(input, {
      headers: { ...protocol, cookie: 'access_token=' + first },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="api"');
    await response.arrayBuffer();
  }

  const forged = await fetch(url, {
    method: 'OPTIONS',
    headers: { ...protocol, 'access-control-request-method': 'GET' },
  });
  assert.equal(forged.status, row.preflightStatus ?? 401);
  if (row.preflightStatus === 405) {
    assert.equal(forged.headers.get('allow'), 'GET');
    assert.equal(forged.headers.get('www-authenticate'), null);
    assert.equal(await forged.text(), 'expected GET method. Got OPTIONS');
  } else {
    await forged.arrayBuffer();
  }

  for (const method of row.methods ?? ['GET', 'POST', 'OPTIONS']) {
    const response = await fetch(url, {
      method,
      headers: {
        origin: options.url,
        ...protocol,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        authorization: 'Bearer ' + first,
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    assert.equal(
      response.status,
      200,
      'Authorized native method must reach its guarded handler: ' + method,
    );
    const body = (await response.json()) as Readonly<Record<string, unknown>>;
    assert.ok(
      body[row.subjectField ?? 'sub'] === subjects[0],
      'Method response must retain only its own identity',
    );
  }

  if (!row.rpc) {
    const missingPost = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(missingPost.status, 401);
    assert.equal(missingPost.headers.get('cache-control'), 'no-store');
    assert.equal(missingPost.headers.get('www-authenticate'), 'Bearer realm="api"');
    assert.ok(
      (await missingPost.text()) ===
        '{"error":"missing_token","error_description":"A bearer token is required."}',
      'Unauthenticated JSON mutation must retain the complete fixed guard rejection',
    );
  }

  const corsUrl = url + '?e2e_cors=1';
  const preflight = await fetch(corsUrl, {
    method: 'OPTIONS',
    headers: {
      ...protocol,
      origin: 'https://cors.example',
      'access-control-request-method': 'GET',
    },
  });
  assert.equal(preflight.status, 204, 'Application CORS must run before required authentication');
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://cors.example');
  assert.equal(preflight.headers.get('x-e2e-cors'), 'before-guard');
  assert.equal(preflight.headers.get('www-authenticate'), null);
  assert.equal(await preflight.text(), '');
  const corsMissing = await fetch(corsUrl, {
    headers: { ...protocol, origin: row.rpc ? options.url : 'https://cors.example' },
  });
  assert.equal(corsMissing.status, 401);
  assert.equal(
    corsMissing.headers.get('access-control-allow-origin'),
    row.rpc ? options.url : 'https://cors.example',
  );
  await corsMissing.arrayBuffer();

  if (!row.streaming) {
    const streamUrl = url + '?e2e_stream=1';
    const rejected = await fetch(streamUrl, { headers: protocol });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.headers.get('x-e2e-stream'), null);
    const nodeJsonCharset = [
      'express-node',
      'fastify-node',
      'next-pages',
      'react-router',
      'reference-express',
    ].includes(row.id);
    assert.equal(
      rejected.headers.get('content-type'),
      nodeJsonCharset ? 'application/json; charset=utf-8' : 'application/json',
    );
    assert.equal(rejected.headers.get('cache-control'), 'no-store');
    assert.equal(rejected.headers.get('www-authenticate'), 'Bearer realm="api"');
    assert.equal(
      await rejected.text(),
      '{"error":"missing_token","error_description":"A bearer token is required."}',
    );
    const accepted = await fetch(streamUrl, {
      headers: { ...protocol, 'accept-encoding': 'identity', authorization: 'Bearer ' + first },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('x-e2e-stream'), 'verified');
    assert.ok(accepted.body);
    const reader = accepted.body.getReader();
    const firstChunk = await reader.read();
    const firstText = new TextDecoder().decode(firstChunk.value);
    assert.equal(firstChunk.done, false);
    assert.equal(
      firstText,
      'verified:' + subjects[0] + '\n',
      'First chunk must arrive before delayed completion',
    );
    let rest = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      rest += new TextDecoder().decode(chunk.value);
    }

    assert.equal(rest, 'complete\n');
  }

  await publicRejection(
    await fetch(url, {
      headers: { ...protocol, authorization: 'Bearer ' + first + ', Bearer invalid' },
    }),
    400,
  );
  assert.deepEqual(
    [
      await duplicateStatus(url, [first, 'invalid'], protocol),
      await duplicateStatus(url, ['invalid', first], protocol),
    ],
    row.duplicates,
    'Raw ingress behavior changed for ' + row.id,
  );
}
