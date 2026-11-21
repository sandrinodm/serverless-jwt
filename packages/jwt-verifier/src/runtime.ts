/**
 * Mirrors jose's runtime exclusions for cross-request I/O promise sharing.
 */
export function canShareInflight(): boolean {
  return (
    !('WebSocketPair' in globalThis) &&
    !(typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') &&
    !(
      'EdgeRuntime' in globalThis &&
      (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime === 'vercel'
    )
  );
}
