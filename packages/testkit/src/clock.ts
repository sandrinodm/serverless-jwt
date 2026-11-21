import { createRequire } from 'node:module';
import { setTimeout as realDelay } from 'node:timers/promises';

/**
 * Pins token time and advances metadata deadlines and the limiter's monotonic hrtime clock. The
 * limiter reads process.hrtime on Node, so Date-only faking cannot prove cooldown behavior.
 */
export function installClock(): {
  advance(milliseconds: number): Promise<void>;
  close(): void;
  now(): number;
  pendingTimers(): number;
} {
  const timers = createRequire(import.meta.url)('@sinonjs/fake-timers') as {
    install(options: object): {
      tickAsync(milliseconds: number): Promise<void>;
      uninstall(): void;
      now: number;
      countTimers(): number;
    };
  };
  const clock = timers.install({
    now: 1_800_000_000_000,
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime'],
  });
  return {
    advance: (milliseconds) => clock.tickAsync(milliseconds),
    close: () => clock.uninstall(),
    now: () => clock.now,
    pendingTimers: () => clock.countTimers(),
  };
}

/**
 * Lets actual loopback I/O progress independently of fake timeout and cooldown clocks.
 */
export async function drainIo(milliseconds = 30): Promise<void> {
  await realDelay(milliseconds);
}
