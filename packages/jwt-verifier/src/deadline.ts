import { JwtVerifierError } from './errors.ts';

/**
 * Owns one total deadline and caller cancellation without cancelling shared I/O.
 */
export class Deadline {
  /**
   * Rejection signal local to this verification.
   */
  readonly signal: AbortSignal;

  /**
   * Deadline controller.
   */
  readonly #controller = new AbortController();

  /**
   * Finite deadline timer.
   */
  readonly #timer: ReturnType<typeof setTimeout>;

  /**
   * Caller signal retained for listener cleanup.
   */
  readonly #caller: AbortSignal | undefined;

  /**
   * Converts caller cancellation into a fixed reason.
   */
  readonly #abort = (): void => {
    this.#controller.abort(new JwtVerifierError('request_aborted'));
  };

  /**
   * Starts the overall timer before any asynchronous pipeline work.
   */
  constructor(seconds: number, caller?: AbortSignal) {
    this.signal = this.#controller.signal;
    this.#caller = caller;
    this.#timer = setTimeout(
      () => this.#controller.abort(new JwtVerifierError('deadline_exceeded')),
      seconds * 1000,
    );
    if (caller?.aborted) {
      this.#abort();
    } else {
      caller?.addEventListener('abort', this.#abort, { once: true });
    }
  }

  /**
   * Races any extension point and removes the race listener after settlement.
   */
  async race<T>(operation: PromiseLike<T> | T): Promise<T> {
    const observed = Promise.resolve(operation);
    void observed.catch(() => {});
    if (this.signal.aborted) {
      throw this.signal.reason;
    }

    /**
     * Listener initialized synchronously by the promise executor before any awaited work.
     */
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = (): void => reject(this.signal.reason);
      this.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      return await Promise.race([observed, aborted]);
    } finally {
      this.signal.removeEventListener('abort', rejectAbort);
    }
  }

  /**
   * Releases the timer and caller listener on either success or failure.
   */
  close(): void {
    clearTimeout(this.#timer);
    this.#caller?.removeEventListener('abort', this.#abort);
  }
}
