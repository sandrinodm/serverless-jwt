/**
 * Implementation-neutral inputs translated by each driver at its public API boundary.
 */
export interface DriverOptions {
  /**
   * Exact configured issuer.
   */
  readonly issuer: string;

  /**
   * Accepted API audience; the mutation fixture deliberately retains a mutable source object.
   */
  readonly audience: string;

  /**
   * Mapping extension whose output must remain separate from verified claims.
   */
  readonly mapClaims?: (claims: Readonly<Record<string, unknown>>) => unknown;

  /**
   * Future policy options passed through without importing a verifier implementation.
   */
  readonly [option: string]: unknown;
}

/**
 * Successful auth fields measured independently of either verifier's concrete return type.
 */
export interface DriverAuth {
  /**
   * Original verified claims.
   */
  readonly claims: Readonly<Record<string, unknown>>;

  /**
   * Separate mapped identity.
   */
  readonly identity: unknown;
}

/**
 * Private rejection fields exposed by a verifier driver, separate from HTTP serialization.
 */
export interface DriverFailure {
  /**
   * Public error code, when available.
   */
  readonly code?: string;

  /**
   * Internal reason, when available.
   */
  readonly reason?: string;

  /**
   * Corresponding HTTP status, when available.
   */
  readonly status?: number;

  /**
   * Failure message captured by the scenario driver.
   */
  readonly message?: string;
}

/**
 * Private diagnostic channel, never part of the sanitized HTTP body.
 */
export interface DriverDiagnostic {
  /**
   * Public diagnostic event discriminator.
   */
  readonly type: string;

  /**
   * Internal rejection reason when this event represents a verification failure.
   */
  readonly reason?: string;
}

/**
 * Public adapter response shape captured without exposing adapter implementation internals.
 */
export interface HttpObservation {
  /**
   * Status sent to the caller.
   */
  readonly status: number;

  /**
   * Exact body sent to the caller.
   */
  readonly body: string;
}

/**
 * Common verifier boundary; future drivers adapt their API here instead of changing scenarios.
 */
export interface Driver {
  /**
   * Creates an instance with mutable input options for the configuration ownership attack.
   */
  readonly create: (options: DriverOptions) => void;

  /**
   * Verifies using the already-created instance. Future drivers return DriverAuth and reject with
   * DriverFailure fields.
   */
  readonly verify: (token: string) => Promise<unknown>;

  /**
   * Extracts an authorization credential through the public header helper.
   */
  readonly extract: (header: string) => string;

  /**
   * Public claim transformation helpers.
   */
  readonly helpers: {
    readonly removeNamespaces: (
      namespace: string,
      claims: Record<string, unknown>,
    ) => Record<string, unknown>;
    readonly claimToArray: (value: string) => ReadonlyArray<string>;
  };

  /**
   * Invokes a real adapter to capture client-visible disclosure.
   */
  readonly respond: (token: string, options: DriverOptions) => Promise<HttpObservation>;

  /**
   * Diagnostics captured during verification.
   */
  readonly diagnostics: () => ReadonlyArray<DriverDiagnostic>;
}
