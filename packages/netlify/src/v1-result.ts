/**
 * Netlify native header values must be serializable scalar values without line breaks.
 */
function headerValue(value: unknown): boolean {
  return typeof value === 'string'
    ? !/[\r\n\0]/u.test(value)
    : typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Validates native single-value or multi-value header containers before a custom result escapes.
 */
function headers(value: unknown, multi: boolean): boolean {
  if (value === undefined) {
    return true;
  }

  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([name, entry]) =>
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) &&
        (multi ? Array.isArray(entry) && entry.every(headerValue) : headerValue(entry)),
    ),
  );
}

/**
 * Netlify v1 requires a numeric status while its SDK permits an omitted string body.
 */
export function isUsableResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const result = value as Readonly<Record<string, unknown>>;
  return (
    typeof result.statusCode === 'number' &&
    Number.isInteger(result.statusCode) &&
    result.statusCode >= 100 &&
    result.statusCode <= 599 &&
    (result.body === undefined || typeof result.body === 'string') &&
    (result.isBase64Encoded === undefined || typeof result.isBase64Encoded === 'boolean') &&
    headers(result.headers, false) &&
    headers(result.multiValueHeaders, true)
  );
}
