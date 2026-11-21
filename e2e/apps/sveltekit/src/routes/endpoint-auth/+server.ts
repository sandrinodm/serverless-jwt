import { requireAuth } from '@serverless-jwt/sveltekit';

/**
 * Requires endpoint authentication even when the deployment path policy intentionally misses it.
 */
export const GET = ({ locals }: { readonly locals: App.Locals }): Response =>
  Response.json(requireAuth(locals).identity);
