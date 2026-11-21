import type { ErrorReason } from './errors.ts';

/**
 * Fixed event vocabulary with no token or claims content.
 */
export type Diagnostic =
  | { readonly type: 'verify.rejected'; readonly reason: ErrorReason }
  | {
      readonly type:
        | 'config.audience_looks_like_client_id'
        | 'claims.scope_and_scp'
        | 'claims.invalid_scope';
    }
  | {
      readonly type: 'jwks.fetch' | 'discovery.fetch';
      readonly url: string;
      readonly status: number;
      readonly durationMs: number;
      readonly keys?: number;
    }
  | {
      readonly type: 'jwks.key_skipped';
      readonly url: string;
      readonly kid?: string;
      readonly problem: 'invalid_key';
    }
  | { readonly type: 'jwks.stale_served'; readonly ageMs: number };

/**
 * Isolates both synchronous throws and rejected thenables without awaiting observability code.
 */
export function emit(
  callback: ((event: Diagnostic) => unknown) | undefined,
  event: Diagnostic,
): void {
  try {
    const result = callback?.(Object.freeze(event));
    void Promise.resolve(result).catch(() => {});
  } catch {
    // Observability must never affect authentication.
  }
}

/**
 * Bounds printable key identifiers before exposing them through diagnostics.
 */
export async function safeKid(value: unknown): Promise<string | undefined> {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (value.length > 64) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }

  return value.replace(/[^\x20-\x7e]/g, '?');
}
