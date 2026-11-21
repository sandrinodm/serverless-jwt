import type { NextRequest } from 'next/server.js';

import { createProxyGuard } from '@serverless-jwt/next';
import { NextResponse } from 'next/server.js';

import { corsPreflight, corsResponse } from './capabilities.ts';
import { options } from './src/options.ts';

/**
 * Early rejection never forwards auth in request headers; the route verifies again.
 */
const guard = createProxyGuard(options);

/**
 * Next awaits the real rejection decision before continuing.
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const preflight = corsPreflight(request);
  if (preflight) {
    return preflight;
  }

  return corsResponse(request, (await guard(request)) ?? NextResponse.next());
}

/**
 * Browser page navigation remains outside this bearer API matcher.
 */
export const config: { readonly matcher: ReadonlyArray<string> } = {
  /**
   * Applies bearer rejection only to API requests, preserving public browser navigation.
   */
  matcher: ['/api/:path*'],
};
