/**
 * Bounded process readiness stays public and independent of issuer availability.
 */
export function GET(): Response {
  return new Response('ready');
}
