import type { RequestHandler } from '@sveltejs/kit';

/**
 * Native readiness is public and independent of protected key retrieval.
 */
export const GET: RequestHandler = () => new Response('ready');
