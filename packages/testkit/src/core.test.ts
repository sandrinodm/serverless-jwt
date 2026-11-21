import { expect, test } from 'vite-plus/test';

import { runScenario } from './drivers/run.ts';
import { scenarios } from './scenarios/index.ts';

/**
 * Bounded subprocess scenario timeout includes watchdog cleanup and real HTTPS fixture I/O.
 */
const SCENARIO_TIMEOUT_MILLIS = 17_000;

test.each(scenarios.filter((entry) => entry.owner === 'core'))(
  '$id matches new core expectations',
  async (entry) => {
    const actual = await runScenario(entry.id, 'core');
    const { limits, ...expected } = entry.expected;
    expect(actual).toMatchObject(expected);
    expect(actual.unhandled).toEqual([]);
    for (const [name, maximum] of Object.entries(limits ?? {})) {
      expect(actual.facts?.[name]).toBeTypeOf('number');
      expect(actual.facts?.[name]).toBeLessThanOrEqual(maximum);
    }
  },
  SCENARIO_TIMEOUT_MILLIS,
);

test.each(scenarios.filter((entry) => entry.owner === 'adapter'))(
  '$id passes through the reference respond driver',
  async (entry) => {
    const actual = await runScenario(entry.id, 'adapter');
    expect(actual).toMatchObject(entry.expected);
    expect(actual.unhandled).toEqual([]);
  },
  SCENARIO_TIMEOUT_MILLIS,
);
