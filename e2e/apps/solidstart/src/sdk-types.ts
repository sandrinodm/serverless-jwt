import type { AnchorProps } from '@solidjs/router';
import type { ErrorBody, HTTPError } from 'h3';

/**
 * Checks real SDK optional fields and rejects incorrect defined values under strict TS7.
 */
export function verifySdkOptionalFields(): void {
  /**
   * Keeps the actual router's optional flags assignable without weakening their value types.
   */
  const optionalAnchorFlags: Pick<AnchorProps, 'noScroll' | 'replace'> = {
    noScroll: undefined,
    replace: undefined,
  };

  /**
   * Invalid router flag values must remain rejected after the optionality repair.
   */
  const invalidAnchorFlag: Pick<AnchorProps, 'noScroll'> = {
    // @ts-expect-error Router flags still require booleans when defined.
    noScroll: 'invalid',
  };

  /**
   * Invalid HTTP error fields must remain rejected after the optionality repair.
   */
  const invalidErrorBody: ErrorBody<{ readonly code: string }> = {
    status: 500,
    message: 'synthetic type fixture',
    // @ts-expect-error HTTP error status text still requires a string when defined.
    statusText: 500,
  };

  /**
   * The remaining repaired fields retain their concrete and generic value types.
   */
  const invalidRemainingFields: ErrorBody<{ readonly code: string }> = {
    status: 500,
    message: 'synthetic type fixture',
    // @ts-expect-error The unhandled flag still requires a boolean.
    unhandled: 'invalid',
    // @ts-expect-error Generic error data still requires its declared payload.
    data: { code: 500 },
    // @ts-expect-error Additional body fields still require a record.
    body: 500,
  };

  /**
   * Both repaired router flags continue rejecting values outside their boolean contract.
   */
  const invalidReplaceFlag: Pick<AnchorProps, 'replace'> = {
    // @ts-expect-error Replace still requires a boolean when defined.
    replace: 'invalid',
  };
  void optionalAnchorFlags;
  void invalidAnchorFlag;
  void invalidErrorBody;
  void invalidRemainingFields;
  void invalidReplaceFlag;
}

/**
 * Checks the SDK's real error class against the public error body it implements.
 */
export function errorBody(
  error: HTTPError<{ readonly code: string }>,
): ErrorBody<{ readonly code: string }> {
  return error;
}
