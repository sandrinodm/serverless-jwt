import { ConfigurationError } from '@serverless-jwt/jwt-verifier';

/**
 * Registration distinguishes unanalysable predicates from checked immutable path patterns.
 */
export type RegisteredPolicy =
  | { readonly kind: 'unregistered' }
  | { readonly kind: 'predicate' }
  | { readonly kind: 'patterns'; readonly patterns: ReadonlyArray<string> };

/**
 * Accepts exact absolute paths and terminal subtrees, without ambiguous glob or encoding syntax.
 */
export function validatePatterns(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigurationError('A nonempty protect pattern list is required');
  }

  const patterns: string[] = [];
  for (const pattern of value) {
    if (typeof pattern !== 'string') {
      throw new ConfigurationError('Invalid protect path pattern');
    }

    const path = pattern.endsWith('/**') ? pattern.slice(0, -3) || '/' : pattern;
    if (
      !path.startsWith('/') ||
      /[%*?#[\]{}\\]/u.test(path) ||
      pattern.includes('//') ||
      path.split('/').some((segment) => segment === '.' || segment === '..') ||
      (path !== '/' && path.endsWith('/'))
    ) {
      throw new ConfigurationError('Invalid protect path pattern');
    }

    patterns.push(pattern);
  }

  return Object.freeze(patterns);
}

/**
 * Matches the framework routing decode contract with a fixed depth bound and no partial-path
 * fallback.
 */
export function routingPath(path: string): string {
  let normalized = path;
  for (let depth = 0; depth <= 10; depth++) {
    let decoded: string;
    try {
      decoded = decodeURI(normalized);
    } catch {
      throw new ConfigurationError('Invalid protected request pathname');
    }

    if (decoded === normalized) {
      return decoded;
    }

    normalized = decoded;
  }

  throw new ConfigurationError('Protected request pathname encoding is too deep');
}

/**
 * Treats subtree roots and trailing slashes consistently without matching adjacent segments.
 */
export function matchesPath(path: string, patterns: ReadonlyArray<string>): boolean {
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return patterns.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const root = pattern.slice(0, -3);
      return normalized === root || normalized.startsWith(root + '/');
    }

    return normalized === pattern;
  });
}

/**
 * Checks the exact ordered immutable policy rather than accepting an unchecked subset.
 */
export function assertRegistration(actual: RegisteredPolicy, expected: RegisteredPolicy): void {
  if (
    actual.kind === 'unregistered' ||
    actual.kind !== expected.kind ||
    (actual.kind === 'patterns' &&
      expected.kind === 'patterns' &&
      (actual.patterns.length !== expected.patterns.length ||
        actual.patterns.some((pattern, index) => pattern !== expected.patterns[index])))
  ) {
    throw new ConfigurationError('Astro JWT policy registration is missing or mismatched');
  }
}
