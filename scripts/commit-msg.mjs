import { readFileSync } from 'node:fs';

/**
 * Reads the proposed commit message for Conventional Commit validation.
 */
const message = readFileSync(process.argv[2], 'utf8');
if (
  !/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [a-z](?:[^\n]*[^.\n])?\n\n\S[\s\S]*$/.test(
    message,
  )
) {
  throw new Error(
    'Use a Conventional Commit with a lowercase imperative subject and explanatory body.',
  );
}
