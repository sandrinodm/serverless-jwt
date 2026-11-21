import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/**
 * Applies the repository commit-subject grammar to squash-merge PR titles, allowing version dots
 * within a subject.
 */
export function checkTitle(title: string): void {
  assert.match(
    title,
    /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: [a-z](?:[^\r\n]*[^.\r\n])?$/,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkTitle(process.env.PR_TITLE ?? '');
}
