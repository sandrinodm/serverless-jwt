import { env, SELF } from 'cloudflare:test';
import { expect, test } from 'vite-plus/test';

import { portableSuite } from '../packages/jwt-verifier/src/portable/suite.spec.ts';
import { canShareInflight } from '../packages/jwt-verifier/src/runtime.ts';
const input = JSON.parse(env.PORTABLE_INPUT);
portableSuite(
  input,
  (name, run) => test(name, run),
  (url, init) => env.ISSUER.fetch(url, init),
);
test('distinct requests use independent workerd I/O and enforce isolate concurrency bounds', async () => {
  expect(canShareInflight()).toBe(false);
  await SELF.fetch('https://worker.test/reset');
  const replies = await Promise.all(
    Array.from({ length: 8 }, () => SELF.fetch('https://worker.test/')),
  );
  expect(replies.filter((reply) => reply.status === 200)).toHaveLength(2);
  expect(replies.filter((reply) => reply.status === 503)).toHaveLength(6);
  const bodies = await Promise.all(replies.map((reply) => reply.json()));
  expect(bodies.filter((body) => body.subject === 'portable')).toHaveLength(2);
  // The verifier-wide capacity contract uses jwks_unavailable even during discovery.
  expect(bodies.filter((body) => body.reason === 'jwks_unavailable')).toHaveLength(6);
});
