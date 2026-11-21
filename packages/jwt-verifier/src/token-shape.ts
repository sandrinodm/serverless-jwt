import { JwtVerifierError } from './errors.ts';

/**
 * Rejects oversized and noncompact credentials before any parsing or network activity.
 */
export function assertTokenShape(token: string, maximum: number): void {
  if (typeof token !== 'string') {
    throw new JwtVerifierError('malformed_token');
  }

  if (token.length > maximum) {
    throw new JwtVerifierError('token_too_large');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2] || parts.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) {
    throw new JwtVerifierError('malformed_token');
  }
}
