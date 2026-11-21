import type { RequestHandler } from '@sveltejs/kit';

/**
 * Public HTML is a real prerendered artifact independent of the protected API.
 */
export const prerender: boolean = true;

/**
 * Public navigation remains available without bearer credentials.
 */
export const GET: RequestHandler = () =>
  new Response('<h1>Public static page</h1>', { headers: { 'content-type': 'text/html' } });
