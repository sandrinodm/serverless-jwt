import { ConfigurationError } from './errors.ts';

/**
 * Verified JSON claims; runtime values are deeply frozen and objects have no prototype.
 */
export type VerifiedClaims = Readonly<Record<string, unknown>>;

/**
 * Converts space-separated strings or string arrays to claims without coercing arbitrary values.
 */
export function claimToArray(value: unknown): ReadonlyArray<string> {
  if (typeof value === 'string') {
    return value.split(' ');
  }

  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

/**
 * Drops pollution keys recursively, creates null-prototype objects and freezes every JSON node.
 */
export function safeClaims(payload: string): VerifiedClaims {
  return JSON.parse(payload, (key: string, value: unknown): unknown => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      return undefined;
    }

    if (value && typeof value === 'object') {
      return Object.freeze(
        Array.isArray(value)
          ? value
          : Object.assign(Object.create(null) as Record<string, unknown>, value),
      );
    }

    return value;
  }) as VerifiedClaims;
}

/**
 * Removes only a leading namespace and fails closed on ambiguous claim names in either order.
 */
export function removeNamespaces(
  claims: VerifiedClaims,
  namespace: string,
): Readonly<Record<string, unknown>> {
  const result = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(claims)) {
    const name = key.startsWith(namespace) ? key.slice(namespace.length) : key;
    if (['__proto__', 'constructor', 'prototype'].includes(name)) {
      continue;
    }

    if (Object.hasOwn(result, name)) {
      throw new ConfigurationError('namespace_collision');
    }

    result[name] = value;
  }

  return Object.freeze(result);
}
