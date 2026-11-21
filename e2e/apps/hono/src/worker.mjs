import { env } from 'cloudflare:workers';

import { createApp } from '../dist/app.mjs';

/**
 * Modern workerd exposes deployment bindings at module scope, retaining one factory per isolate.
 */
const app = createApp({
  issuer: env.ISSUER,
  audience: 'https://resource.example',
  ...(env.JWKS_URI ? { jwksUri: env.JWKS_URI } : {}),
});

export default app;
