import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/**
 * Rejects failure, cancellation and unexpected skips even when GitHub would accept a skipped
 * required job.
 */
export function checkNeeds(
  needs: Readonly<Record<string, { readonly result: string }>>,
  allowedSkips: ReadonlyArray<string>,
): void {
  assert.ok(Object.keys(needs).length > 0, 'No prerequisite results');
  for (const [name, { result }] of Object.entries(needs)) {
    assert.ok(
      result === 'success' || (result === 'skipped' && allowedSkips.includes(name)),
      `${name}: ${result}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowed = process.env.GITHUB_EVENT_NAME === 'schedule' ? [] : ['core-nightly'];
  checkNeeds(
    JSON.parse(process.env.CI_NEEDS ?? '{}') as Readonly<
      Record<string, { readonly result: string }>
    >,
    allowed,
  );
}
