import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Prints completed capability rows outside Vitest's captured test console output.
 */
export default class ConformanceReporter {
  /**
   * Isolates native-runtime artifacts from the ordinary Node run without retaining stale rows.
   */
  constructor(options = {}) {
    this.directory = resolve(options.directory ?? 'reports/conformance');
  }

  /**
   * Removes prior-run rows so a filtered run cannot report stale conformance successes.
   */
  onTestRunStart() {
    rmSync(this.directory, { recursive: true, force: true });
    mkdirSync(this.directory, { recursive: true });
    this.started = Date.now();
  }

  /**
   * Displays the case-by-entrypoint table emitted by the actual registered suites.
   */
  onTestRunEnd() {
    const directory = this.directory;
    if (!existsSync(directory)) {
      return;
    }

    const rows = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8')));
    console.table(rows);
    writeFileSync(
      resolve(directory, '.run.json'),
      JSON.stringify({ started: this.started, completed: Date.now() }) + '\n',
    );
  }
}
