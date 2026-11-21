import { createApp } from '../dist/app.mjs';

/**
 * Deno reads only the explicitly granted deployment bindings before serving native HTTP.
 */
const issuer = Deno.env.get('ISSUER');
/**
 * Optional direct key endpoint supports outage contracts.
 */
const jwksUri = Deno.env.get('JWKS_URI');
/**
 * One app owns its verifier in this Deno process.
 */
const app = createApp({
  issuer,
  audience: 'https://resource.example',
  ...(jwksUri ? { jwksUri } : {}),
});

Deno.serve({ hostname: '127.0.0.1', port: Number(Deno.env.get('PORT')) }, app.fetch);
