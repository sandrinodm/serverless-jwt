import type { VerifiedClaims } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { Auth } from './verify.ts';

import { claimToArray } from './claims.ts';
import { emit } from './diagnostics.ts';
import { ConfigurationError, JwtVerifierError } from './errors.ts';

/**
 * Derives immutable deduplicated scopes from verified claims, preferring scope to scp.
 */
export function scopesFromClaims(
  claims: VerifiedClaims,
  diagnostic?: (event: Diagnostic) => unknown,
): ReadonlyArray<string> {
  if ('scope' in claims && 'scp' in claims) {
    emit(diagnostic, { type: 'claims.scope_and_scp' });
  }

  const primary = 'scope' in claims;
  const value = primary ? claims.scope : claims.scp;
  if (value === undefined && !primary && !('scp' in claims)) {
    return Object.freeze([]);
  }

  if (
    typeof value !== 'string' &&
    !(Array.isArray(value) && !primary && value.every((entry) => typeof entry === 'string'))
  ) {
    emit(diagnostic, { type: 'claims.invalid_scope' });
    return Object.freeze([]);
  }

  const tokens = claimToArray(value);
  const valid = tokens.filter((scope) => /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope));
  if (valid.length !== tokens.length) {
    emit(diagnostic, { type: 'claims.invalid_scope' });
  }

  return Object.freeze([...new Set(valid)]);
}

/**
 * Validates required scopes and mode at helper and future integration boundaries.
 */
export function validateScopes(required: ReadonlyArray<string>, mode: 'all' | 'any'): void {
  if (!Array.isArray(required) || !required.length || (mode !== 'all' && mode !== 'any')) {
    throw new ConfigurationError('invalid_scopes');
  }

  for (let index = 0; index < required.length; index++) {
    const scope = Object.hasOwn(required, index) ? required[index] : undefined;
    if (typeof scope !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope)) {
      throw new ConfigurationError('invalid_scopes');
    }
  }
}

/**
 * Tests configured scopes against the verified scope set.
 */
export function hasScopes(
  auth: Auth<unknown>,
  required: ReadonlyArray<string>,
  mode: 'all' | 'any' = 'all',
): boolean {
  validateScopes(required, mode);
  return mode === 'all'
    ? required.every((scope) => auth.scopes.includes(scope))
    : required.some((scope) => auth.scopes.includes(scope));
}

/**
 * Requires configured scopes and throws a fixed insufficient-scope error on denial.
 */
export function requireScopes(
  auth: Auth<unknown>,
  required: ReadonlyArray<string>,
  mode: 'all' | 'any' = 'all',
): void {
  if (!hasScopes(auth, required, mode)) {
    throw new JwtVerifierError('insufficient_scope', { scopes: required });
  }
}
