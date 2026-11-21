/**
 * Injectable wall clock used consistently for key lifetimes and NumericDates.
 */
export interface Clock {
  /**
   * Returns Unix time in milliseconds.
   */
  readonly now: () => number;
}
