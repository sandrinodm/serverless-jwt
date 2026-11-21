import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Current independent runs own disjoint namespaces and cannot delete or impersonate other forms.
 */
const inventory = {
  'reports/conformance': [
    'reference/fetch',
    'reference/express',
    'hono/middleware',
    'next/app-router',
    'next/proxy',
    'vercel/web',
    'netlify/functions-v2',
    'netlify/edge',
    'sveltekit/handle',
    'astro/middleware',
    'react-router/middleware',
    'tanstack-start/request',
    'tanstack-start/function',
    'express/middleware',
    'fastify/plugin',
    'aws-lambda/apiGatewayV1',
    'aws-lambda/apiGatewayV2',
    'aws-lambda/alb',
    'aws-lambda/alb-single-value',
    'next/pages',
    'netlify/functions-v1',
    'nuxt/h3-v1',
    'nuxt/h3-v2',
  ],
  'reports/conformance-workerd': ['cloudflare/workers', 'cloudflare/pages'],
};
/**
 * Mandatory suite contract, with transport-only capability rows included explicitly.
 */
const cases = [
  'missing',
  'basic',
  'empty-bearer',
  'comma',
  'oversize',
  'valid-mapping-forwarding',
  'expired',
  'audience',
  'issuer',
  'signature',
  'none',
  'scopes-all',
  'scopes-challenge',
  'scopes-any',
  'scopes-any-denied',
  'scopes-all-valid',
  'optional-missing',
  'optional-invalid',
  'forged-preflight',
  'skip-before-credentials',
  'already-aborted',
  'abort-shared-fetch',
  'configuration-conflict',
  'onError-async-response',
  'onError-throw',
  'onError-reject',
  'onError-unusable',
  'onError-consumed',
  'onError-locked',
  'onError-undefined',
  'existing-verifier-observer-throw',
  'existing-verifier-observer-reject',
  'jwks-outage',
  'discovery-mismatch',
  'handler-error',
  'isolation-200',
  'duplicateHeaders',
  'streaming',
].sort((left, right) => left.localeCompare(right));
/**
 * Retains each verified run's exact rows and timestamp envelope in one reviewable artifact.
 */
const runs = [];
for (const [directory, entries] of Object.entries(inventory)) {
  const run = JSON.parse(readFileSync(join(directory, '.run.json'), 'utf8'));
  assert.ok(
    Number.isFinite(run.started) && Number.isFinite(run.completed) && run.completed >= run.started,
  );
  const files = readdirSync(directory).filter(
    (name) => !name.startsWith('.') && name.endsWith('.json'),
  );
  assert.deepEqual(
    files.sort((left, right) => left.localeCompare(right)),
    entries
      .map((entry) => entry.replaceAll('/', '-') + '.json')
      .sort((left, right) => left.localeCompare(right)),
  );
  const rows = files.flatMap((file) => {
    const path = join(directory, file);
    const timestamp = statSync(path).mtimeMs;
    assert.ok(
      timestamp >= run.started - 1 && timestamp <= run.completed + 1,
      'Conformance file is outside its fresh run',
    );
    return JSON.parse(readFileSync(path, 'utf8'));
  });
  for (const entry of entries) {
    const results = rows.filter((row) => row.entrypoint === entry);
    assert.deepEqual(
      results.map((row) => row.case).sort((left, right) => left.localeCompare(right)),
      cases,
      'Missing, duplicate or unknown conformance cases',
    );
    for (const row of results) {
      assert.ok(
        row.result === 'pass' ||
          (row.result === 'skip' &&
            ['duplicateHeaders', 'streaming'].includes(row.case) &&
            typeof row.reason === 'string' &&
            row.reason.includes('lost guarantee:')),
      );
    }
  }

  runs.push({ directory, ...run, rows });
}

writeFileSync('reports/conformance-all.json', JSON.stringify({ runs }, null, 2) + '\n');
console.log(
  'Verified ' +
    runs.reduce((total, run) => total + run.rows.length, 0) +
    ' fresh capability rows across every registered form.',
);
