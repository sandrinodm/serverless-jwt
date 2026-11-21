import type { ResolvedOptions } from './options.ts';

import { JwtVerifierError } from './errors.ts';

/**
 * Synchronous network capacity shared by discovery and all stores of one verifier.
 */
export class FetchBudget {
  /**
   * Reservations that have not settled yet.
   */
  #active = 0;

  /**
   * Maximum simultaneous nonsharing operations.
   */
  readonly #limit: number;

  /**
   * Creates a budget without global state or shared I/O promises.
   */
  constructor(options: ResolvedOptions<unknown>) {
    this.#limit = options.keys.maxConcurrentFetches;
  }

  /**
   * Acquires capacity synchronously before scheduling any network work.
   */
  reserve(): boolean {
    if (this.#active >= this.#limit) {
      return false;
    }

    this.#active++;
    return true;
  }

  /**
   * Releases exactly one owned reservation after success or failure.
   */
  release(): void {
    this.#active--;
  }
}

/**
 * Per-verifier ownership, generation and outage policy shared by discovery and key fetching.
 */
export class FetchState<T> {
  /**
   * Latest successful cache value.
   */
  value: T | undefined;

  /**
   * Successful cache timestamp; failures never change it.
   */
  fetchedAt: number = -Infinity;

  /**
   * Latest reserved attempt timestamp, including failures.
   */
  lastAttemptAt: number = -Infinity;

  /**
   * Earliest retry after a failure.
   */
  backoffUntil: number = -Infinity;

  /**
   * Current pending shared operation.
   */
  #inflight: Promise<T> | undefined;

  /**
   * Number of owned operations in nonsharing runtimes.
   */
  #active = 0;

  /**
   * Monotonic reservation counter.
   */
  #generation = 0;

  /**
   * Generation of the last committed successful value.
   */
  #cachedGeneration = 0;

  /**
   * Number of consecutive failed fetches.
   */
  #failures = 0;

  /**
   * Fully owned verifier policy.
   */
  readonly #options: ResolvedOptions<unknown>;

  /**
   * Fixed outage classification.
   */
  readonly #kind: 'jwks' | 'discovery';

  /**
   * Capacity owned by the containing verifier across all resource endpoints.
   */
  readonly #budget: FetchBudget;

  /**
   * Creates state confined to one verifier and resource endpoint.
   */
  constructor(
    options: ResolvedOptions<unknown>,
    kind: 'jwks' | 'discovery',
    budget: FetchBudget = new FetchBudget(options),
  ) {
    this.#options = options;
    this.#kind = kind;
    this.#budget = budget;
  }

  /**
   * Returns a bounded retry error without reflecting the endpoint or original exception.
   */
  unavailable(): JwtVerifierError {
    return new JwtVerifierError(
      this.#kind === 'jwks' ? 'jwks_unavailable' : 'discovery_unavailable',
      { retryAfter: Math.max(1, (this.backoffUntil - this.#options.clock.now()) / 1000) },
    );
  }

  /**
   * Reserves before I/O, shares only where safe and commits only newer successful generations.
   */
  load(operation: () => Promise<T>, unknownKey = false): Promise<T> {
    const options = this.#options;
    const now = options.clock.now();
    if (options.shareInflight && this.#inflight) {
      return this.#inflight;
    }

    if (
      unknownKey &&
      (now < this.backoffUntil || now - this.lastAttemptAt < options.keys.cooldown * 1000)
    ) {
      return Promise.reject(new JwtVerifierError('key_not_found'));
    }

    if (now < this.backoffUntil) {
      return Promise.reject(this.unavailable());
    }

    if (!options.shareInflight && this.#active > 0 && this.value !== undefined) {
      return Promise.reject(
        unknownKey ? new JwtVerifierError('key_not_found') : this.unavailable(),
      );
    }

    if (!options.shareInflight && !this.#budget.reserve()) {
      return Promise.reject(new JwtVerifierError('jwks_unavailable', { retryAfter: 1 }));
    }

    this.lastAttemptAt = now;
    const generation = ++this.#generation;
    this.#active++;
    const promise = Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (generation > this.#cachedGeneration) {
            this.value = value;
            this.fetchedAt = options.clock.now();
            this.#cachedGeneration = generation;
            this.#failures = 0;
            this.backoffUntil = -Infinity;
          }

          return this.value as T;
        },
        (error: unknown) => {
          if (generation >= this.#cachedGeneration) {
            this.#failures++;
            this.backoffUntil =
              options.clock.now() +
              Math.max(
                1,
                Math.random() * Math.min(30_000, 1000 * 2 ** Math.min(5, this.#failures - 1)),
              );
          }

          if (
            error instanceof JwtVerifierError &&
            error.code === 'temporarily_unavailable' &&
            error.reason !== 'deadline_exceeded' &&
            error.reason !== 'request_aborted'
          ) {
            throw new JwtVerifierError(error.reason, {
              cause: error.cause,
              retryAfter: (this.backoffUntil - options.clock.now()) / 1000,
            });
          }

          throw error;
        },
      )
      .finally(() => {
        this.#active--;
        if (!options.shareInflight) {
          this.#budget.release();
        }

        if (this.#inflight === promise) {
          this.#inflight = undefined;
        }
      });
    void promise.catch(() => {});
    if (options.shareInflight) {
      this.#inflight = promise;
    }

    return promise;
  }
}
