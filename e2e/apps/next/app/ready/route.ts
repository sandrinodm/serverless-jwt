/**
 * Local readiness is outside the protected proxy matcher.
 */
export function GET(): Response {
  return new Response('ready');
}
