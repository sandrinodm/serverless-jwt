import type { Observation } from '../scenarios/index.ts';

/**
 * Removes run-specific ports and elapsed time while preserving every asserted observable subclaim.
 */
export function normalizeObservation(observation: Observation): Readonly<Record<string, unknown>> {
  /**
   * Preserves nonfinite numeric evidence before serializing the stable baseline.
   */
  const stable = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value.length > 1024
        ? { stringLength: value.length }
        : value.replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, '<issuer>');
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map(stable);
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, stable(child)]));
    }

    return value;
  };
  const { elapsed: _elapsed, ...rest } = observation;
  return stable(rest) as Readonly<Record<string, unknown>>;
}
