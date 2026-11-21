import type { installClock } from '../clock.ts';
import type { Driver, HttpObservation } from '../drivers/types.ts';
import type { IssuerScript, startIssuer } from '../issuer.ts';
import type { SigningKey } from '../keys.ts';

import { algorithmScenarios } from './algorithms.ts';
import { availabilityScenarios } from './availability.ts';
import { claimScenarios } from './claims.ts';
import { discoveryScenarios } from './discovery.ts';
import { headerScenarios, oversizedPipelineScenario } from './headers.ts';
import { keyScenarios } from './keys.ts';
import { mappingScenarios } from './mapping.ts';
import { namespaceScenarios } from './namespaces.ts';
import { timeScenarios } from './time.ts';

/**
 * One asserted outcome with public error code separated from internal reason and HTTP status.
 */
export interface Expectation {
  /**
   * Observable completion category, never inferred from a wall-clock race alone.
   */
  readonly outcome: 'accepted' | 'rejected' | 'never_settles' | 'deadline_exceeded';

  /**
   * Public error code where the implementation exposes one.
   */
  readonly code?: string;

  /**
   * Internal diagnostic reason.
   */
  readonly reason?: string;

  /**
   * Client-visible HTTP status where applicable.
   */
  readonly status?: number;

  /**
   * Additional stable black-box facts asserted separately from dynamic observation data.
   */
  readonly facts?: Readonly<Record<string, unknown>>;

  /**
   * Upper bounds on numeric observed facts, checked by conformance assertions.
   */
  readonly limits?: Readonly<Record<string, number>>;
}

/**
 * Recorded public behavior, endpoint counts and isolated unhandled rejections.
 */
export interface Observation extends Expectation {
  /**
   * Original success value for claims and helper assertions.
   */
  readonly value?: unknown;

  /**
   * Original failure message, including reflected values where observed.
   */
  readonly message?: string;

  /**
   * Requests per issuer endpoint.
   */
  readonly hits?: Readonly<Record<string, number>>;

  /**
   * Unhandled failures captured only inside the scenario child.
   */
  readonly unhandled?: ReadonlyArray<string>;

  /**
   * Elapsed time in milliseconds measured with a monotonic clock.
   */
  readonly elapsed?: number;

  /**
   * Exact client-visible adapter response, normalized only after capture.
   */
  readonly http?: HttpObservation;
}

/**
 * Reusable black-box scenario resources independent of the verifier API.
 */
export interface ScenarioContext {
  /**
   * Implementation boundary.
   */
  readonly driver: Driver;

  /**
   * Scriptable verified HTTPS issuer.
   */
  readonly issuer: Awaited<ReturnType<typeof startIssuer>>;

  /**
   * Synthetic signing key.
   */
  readonly key: SigningKey;

  /**
   * Fake deadline and cooldown controller.
   */
  readonly clock: ReturnType<typeof installClock>;

  /**
   * Verifies and observes pending operations after advancing the fixture clock.
   */
  readonly observe: (operation: () => unknown) => Promise<Observation>;
}

/**
 * A portable regression scenario and the driver that exercises it.
 */
export interface Scenario {
  /**
   * Stable test identifier.
   */
  readonly id: string;

  /**
   * Issuer response script; scenarios may replace it during execution.
   */
  readonly issuer: IssuerScript;

  /**
   * Executes only through public driver and fixture boundaries.
   */
  readonly run: (context: ScenarioContext) => Promise<Observation>;

  /**
   * Required observable behavior.
   */
  readonly expected: Expectation;

  /**
   * Driver used to exercise this scenario.
   */
  readonly owner: 'core' | 'adapter';

  /**
   * Describes exact attack input and the subclaim proven or refuted.
   */
  readonly description: string;

  /**
   * Verifier configuration passed to the driver.
   */
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * Scenario registry for the core and adapter regression tests.
 */
export const scenarios: ReadonlyArray<Scenario> = [
  ...algorithmScenarios,
  ...claimScenarios,
  ...timeScenarios,
  ...keyScenarios,
  ...discoveryScenarios,
  ...headerScenarios,
  oversizedPipelineScenario,
  ...mappingScenarios,
  ...namespaceScenarios,
  ...availabilityScenarios,
];
