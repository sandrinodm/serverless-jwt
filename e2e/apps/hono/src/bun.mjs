import { createApp } from '../dist/app.mjs';

/**
 * Bun uses its actual native HTTP server and the same complete built app.
 */
const app = createApp({
  issuer: Bun.env.ISSUER,
  audience: 'https://resource.example',
  ...(Bun.env.JWKS_URI ? { jwksUri: Bun.env.JWKS_URI } : {}),
});

Bun.serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(Bun.env.PORT) });
