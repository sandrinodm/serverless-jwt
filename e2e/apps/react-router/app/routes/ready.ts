/**
 * Fixed readiness avoids compiling or authenticating an API during startup probes.
 */
export function loader(): Response {
  return new Response('ready');
}
