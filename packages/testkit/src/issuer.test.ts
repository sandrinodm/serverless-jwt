import { expect, test } from 'vite-plus/test';

import { startIssuer, issuerTransport } from './issuer.ts';

test('requires the dedicated test CA and keeps TLS certificate verification enabled', async () => {
  await using issuer = await startIssuer({ script: () => ({ json: { verified: true } }) });
  await expect(fetch(issuer.url)).rejects.toThrow('fetch failed');
  const transport = issuerTransport();
  try {
    const response = await transport.fetch(issuer.url);
    expect(await response.json()).toEqual({ verified: true });
    expect(issuer.hits['/']).toBe(1);
  } finally {
    await transport.close();
  }
});
