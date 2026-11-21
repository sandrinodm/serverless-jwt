import { expect, test } from 'vite-plus/test';

import { createJwtVerifier, getBearerToken } from './index.ts';
test('exports the verifier and bearer helper', () => {
  expect(createJwtVerifier).toBeTypeOf('function');
  expect(getBearerToken('Bearer value')).toEqual({ ok: true, token: 'value' });
});
