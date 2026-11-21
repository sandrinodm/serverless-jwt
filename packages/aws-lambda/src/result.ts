/**
 * Lambda header records must serialize to native ingress values rather than arbitrary objects.
 */
function headers(value: unknown, multi: boolean, stringsOnly: boolean): boolean {
  if (value === undefined) {
    return true;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([name, entry]) =>
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) &&
      (multi
        ? Array.isArray(entry) && entry.every((item) => headerValue(item, stringsOnly))
        : headerValue(entry, stringsOnly)),
  );
}

/**
 * Native header values cannot contain line breaks or nonfinite JSON numbers.
 */
function headerValue(value: unknown, stringsOnly: boolean): boolean {
  return typeof value === 'string'
    ? !/[\r\n\0]/u.test(value)
    : !stringsOnly &&
        (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
}

/**
 * Validates each SDK result shape at the JavaScript boundary, preserving valid v2 defaults and ALB
 * mode exclusivity.
 */
export function isUsableResult(
  value: unknown,
  shape: 'apiGatewayV1' | 'apiGatewayV2' | 'albMultiValue' | 'albSingleValue',
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const result = value as Readonly<Record<string, unknown>>;
  const v2 = shape === 'apiGatewayV2';
  const alb = shape === 'albMultiValue' || shape === 'albSingleValue';
  if (
    !(v2 && result.statusCode === undefined) &&
    (typeof result.statusCode !== 'number' ||
      !Number.isInteger(result.statusCode) ||
      result.statusCode < 100 ||
      result.statusCode > 599)
  ) {
    return false;
  }

  if (
    shape === 'apiGatewayV1'
      ? typeof result.body !== 'string'
      : result.body !== undefined && typeof result.body !== 'string'
  ) {
    return false;
  }

  if (result.isBase64Encoded !== undefined && typeof result.isBase64Encoded !== 'boolean') {
    return false;
  }

  if (!headers(result.headers, false, alb) || !headers(result.multiValueHeaders, true, alb)) {
    return false;
  }

  if ((v2 || shape === 'albSingleValue') && result.multiValueHeaders !== undefined) {
    return false;
  }

  if (shape === 'albMultiValue' && result.headers !== undefined) {
    return false;
  }

  if (
    alb &&
    result.statusDescription !== undefined &&
    (typeof result.statusDescription !== 'string' || /[\r\n\0]/u.test(result.statusDescription))
  ) {
    return false;
  }

  if (
    result.cookies !== undefined &&
    (!v2 ||
      !Array.isArray(result.cookies) ||
      !result.cookies.every((cookie) => typeof cookie === 'string' && !/[\r\n\0]/u.test(cookie)))
  ) {
    return false;
  }

  return true;
}
