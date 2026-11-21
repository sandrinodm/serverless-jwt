import type { APIRoute } from 'astro';

/**
 * Readiness stays public and does not retrieve keys.
 */
export const GET: APIRoute = () => new Response('ready');
