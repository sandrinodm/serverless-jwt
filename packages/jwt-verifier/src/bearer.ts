/**
 * Header extraction result independent of token verification and HTTP adapters.
 */
export type BearerResult =
  | { readonly ok: true; readonly token: string }
  | {
      readonly ok: false;
      readonly reason: 'missing_token' | 'malformed_header' | 'multiple_credentials';
    };

/**
 * Extracts a single RFC 6750 bearer credential without trimming forbidden controls.
 */
export function getBearerToken(
  value: string | ReadonlyArray<string> | null | undefined,
): BearerResult {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return { ok: false, reason: 'missing_token' };
  }

  if (Array.isArray(value) && value.length > 1) {
    return { ok: false, reason: 'multiple_credentials' };
  }

  const header = typeof value === 'string' ? value : value[0];
  if (
    typeof header !== 'string' ||
    Array.from(header).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    return { ok: false, reason: 'malformed_header' };
  }

  if (header.includes(',')) {
    return { ok: false, reason: 'multiple_credentials' };
  }

  const trimmed = header.replace(/^ +| +$/g, '');
  if (!trimmed) {
    return { ok: false, reason: 'missing_token' };
  }

  if (!/^Bearer(?: |$)/i.test(trimmed)) {
    return { ok: false, reason: 'missing_token' };
  }

  const match = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(trimmed);
  return match?.[1] ? { ok: true, token: match[1] } : { ok: false, reason: 'malformed_header' };
}
