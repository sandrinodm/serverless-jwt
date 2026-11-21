import { serve } from '@hono/node-server';

import { createApp } from '../dist/app.mjs';

/**
 * Node's actual Hono host receives deployment configuration only at startup.
 */
const app = createApp({
  issuer: process.env.ISSUER,
  audience: 'https://resource.example',
  ...(process.env.JWKS_URI ? { jwksUri: process.env.JWKS_URI } : {}),
});

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT) });
