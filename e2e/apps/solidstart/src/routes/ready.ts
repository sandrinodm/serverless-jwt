/**
 * Native SolidStart readiness stays public without touching authentication state.
 */
export function GET(): Response {
  return new Response('ready');
}
