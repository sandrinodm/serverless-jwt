import type { IntegrationOptions } from '../../../jwt-verifier/src/adapter.ts';
import type { Auth, JwtVerifierError } from '../../../jwt-verifier/src/index.ts';

/**
 * Inputs shared by real-platform harnesses; semantic cases cannot be disabled.
 */
export interface RequestSpec {
  /**
   * Repeated header lines retained where the transport supports them.
   */
  readonly headers?: ReadonlyArray<readonly [string, string]>;

  /**
   * Request method, defaulting to GET.
   */
  readonly method?: string;

  /**
   * Per-request cancellation signal.
   */
  readonly signal?: AbortSignal;
}

/**
 * Normalized response preserving public status, headers and body.
 */
export interface ResponseSpec {
  /**
   * HTTP status sent by the platform.
   */
  readonly status: number;

  /**
   * Lowercase response headers.
   */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Exact response text.
   */
  readonly body: string;
}

/**
 * Handler boundary driven by the conformance suite with per-request auth and platform context.
 */
export type TestHandler = (
  auth: Auth<unknown> | null | undefined,
  forwarded: Readonly<Record<string, unknown>>,
) => Response | Promise<Response>;

/**
 * Adapter-specific error hook exercised asynchronously by every harness.
 */
export type TestOptions = IntegrationOptions<unknown> & {
  /**
   * Test hook translated to the integration's platform-specific error hook.
   */
  readonly onError?: (
    error: JwtVerifierError,
    platformArgs: Readonly<Record<string, unknown>>,
  ) => unknown;
};

/**
 * Disposable app constructed once per test configuration.
 */
export interface HarnessInstance {
  /**
   * Sends a request using the platform's real request/response types.
   */
  readonly send: (request: RequestSpec) => Promise<ResponseSpec>;

  /**
   * Observes incremental response chunks when streaming is claimed by the transport.
   */
  readonly stream?: (
    request: RequestSpec,
    onChunk: (chunk: string) => void,
  ) => Promise<ResponseSpec>;

  /**
   * Releases app resources after the case.
   */
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * One registration for each public integration form.
 */
export interface AdapterHarness {
  /**
   * Runtime I/O ownership contract, independently asserted by native runtime probes.
   */
  readonly ioOwnership?: 'shared' | 'request';

  /**
   * Proxy rejection plus independent route verification uses two real authentication stages.
   */
  readonly verificationStages?: 1 | 2;

  /**
   * Unique entrypoint name used in capability reports.
   */
  readonly name: string;

  /**
   * Builds the guarded handler once, passing options through unchanged.
   */
  readonly setup: (options: TestOptions, handler: TestHandler) => Promise<HarnessInstance>;
}

/**
 * A transport limitation explicitly states both the cause and lost guarantee.
 */
export interface TransportGap {
  /**
   * Platform-specific reason the transport cannot provide this feature.
   */
  readonly reason: string;

  /**
   * Security or delivery guarantee unavailable at this ingress.
   */
  readonly guarantee: string;
}

/**
 * Only transport features may be skipped; authentication semantics have no capability switches.
 */
export interface Capabilities {
  /**
   * Whether separate duplicate lines survive ingress, possibly through comma joining.
   */
  readonly duplicateHeaders: true | TransportGap;

  /**
   * Whether streaming handlers are supported.
   */
  readonly streaming: true | TransportGap;
}

/**
 * One visible case-by-entrypoint result.
 */
export interface CapabilityResult {
  /**
   * Public entrypoint registration.
   */
  readonly entrypoint: string;

  /**
   * Mandatory semantic or optional transport case name.
   */
  readonly case: string;

  /**
   * Result from actually executing the case.
   */
  readonly result: 'pass' | 'skip' | 'fail';

  /**
   * Explicit transport limitation for skipped cases.
   */
  readonly reason?: string;
}
