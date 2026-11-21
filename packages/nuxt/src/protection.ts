import { ConfigurationError } from '@serverless-jwt/jwt-verifier';

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
 * Requires synchronous booleans and observes malformed asynchronous predicate results immediately.
 */
export function evaluatePredicate<TEvent>(
  predicate: (event: TEvent) => boolean,
  event: TEvent,
): boolean {
  const result: unknown = predicate(event);
  if (typeof result !== 'boolean') {
    void Promise.resolve(result).catch(() => {});
    throw new Error('Invalid protect predicate result');
  }

  return result;
}

/**
 * Decodes literal routing characters once while preserving percent and encoded slash boundaries.
 */
export function routingPath(path: string): string {
  try {
    return decodeURIComponent(path.replace(/%(?:25|2f)/giu, (value) => '%25' + value.slice(1)));
  } catch {
    throw new ConfigurationError('Invalid protected request pathname');
  }
}

/**
 * Matches h3 v1's path decoding before its router removes the decoded query suffix.
 */
export function nodeRoutingPath(url: string): string {
  return routingPath(url.replace(/\?.*/su, '')).replace(/\?.*/su, '');
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
