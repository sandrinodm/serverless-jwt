import type { JwtEnv } from '@serverless-jwt/hono';
import type { JwtVerifierOptions, VerifiedClaims } from '@serverless-jwt/jwt-verifier';

import { jwt } from '@serverless-jwt/hono';
import { Hono } from 'hono';

import { capabilityResponse, corsPreflight, corsResponse } from '../capabilities.ts';

/**
 * Separates mapped identity from the original verified claims in every runtime.
 */
export interface Identity {
  /**
   * Verified subject copied by mapClaims without trusting request headers.
   */
  readonly subject: unknown;
}

/**
 * Constructs the real Hono app once per runtime process or isolate.
 */
export function createApp(options: JwtVerifierOptions): Hono<JwtEnv<Identity>> {
  const app = new Hono<JwtEnv<Identity>>();
  app.get('/ready', (context) => context.text('ready'));
  app.use('/api/*', async (context, next): Promise<Response | void> => {
    const preflight = corsPreflight(context.req.raw);
    if (preflight) {
      return preflight;
    }

    await next();
    context.res = corsResponse(context.req.raw, context.res);
  });
  app.use(
    '/api/*',
    jwt<Identity>({
      ...options,
      mapClaims: (claims: VerifiedClaims): Identity => ({ subject: claims.sub }),
    }),
  );
  app.all('/api/me', (context) =>
    capabilityResponse(
      context.req.raw,
      context.var.auth.identity.subject,
      context.json({
        sub: context.var.auth.identity.subject,
        scopes: context.var.auth.scopes,
      }),
    ),
  );
  return app;
}
