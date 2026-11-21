/**
 * Actual Vercel local readiness remains outside the protected function.
 */
export function GET(): Response {
  return new Response('ready');
}
