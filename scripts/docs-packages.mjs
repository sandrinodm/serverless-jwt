import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'vite-plus/fmt';

import { capabilityMatrix } from '../e2e/matrix.ts';
import configuration from '../vite.config.ts';

/**
 * Loads integration environments used to generate package README sections.
 */
const environments = JSON.parse(
  readFileSync(new URL('./docs-package-environments.json', import.meta.url), 'utf8'),
);
/**
 * Discovers public integrations whose README environment blocks must stay consistent.
 */
const packages = readdirSync('packages')
  .map((directory) => ({
    directory,
    manifest: JSON.parse(readFileSync(join('packages', directory, 'package.json'), 'utf8')),
  }))
  .filter(({ manifest }) => !manifest.private);
assert.deepEqual(
  packages.map(({ directory }) => directory).sort(),
  Object.keys(environments).sort(),
  'Each public package requires reviewed environment information',
);
/**
 * Defines the shared documentation navigation rendered into every integration README.
 */
const navigation =
  '[README](../../README.md) · [Getting started](../../docs/getting-started.md) · [Configuration](../../docs/configuration.md) · [Errors](../../docs/errors.md) · [Compatibility](../../docs/compatibility.md)';
for (const { directory, manifest } of packages) {
  const file = join('packages', directory, 'README.md');
  let source = readFileSync(file, 'utf8');
  assert.ok(
    source.startsWith('# ' + manifest.name + '\n'),
    'README package heading must match manifest: ' + directory,
  );
  let body = source.slice(source.indexOf('\n') + 1).trimStart();
  if (body.startsWith(navigation)) {
    body = body.slice(navigation.length).trimStart();
  }

  body = body
    .replace(/<!-- tested-environments:start -->[\s\S]*?<!-- tested-environments:end -->\s*/g, '')
    .trimEnd();
  const rows = capabilityMatrix.filter(({ integration }) => integration === directory);
  const runtimeEvidence = rows.length
    ? `\n\n### Local capability matrix\n\nDuplicate results list the HTTP status for two Authorization header orders, valid first and invalid first.\n\n| Form / host | Project | Route | Duplicate results | Measured limits |\n| --- | --- | --- | --- | --- |\n${rows
        .map((row) => {
          const limits = [
            row.duplicateReason,
            row.preflightReason,
            row.cacheReason,
            row.streaming === 'event-result' ? 'Event-result API: no incremental HTTP body.' : '',
            row.streaming === 'build-only' ? 'Build-only policy: no HTTP response.' : '',
            row.streaming === 'preparation-only'
              ? 'Declaration preparation: no HTTP response.'
              : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `| ${row.id} / ${row.host} (\`${row.entrypoint}\`) | ${row.project} | \`${row.route}\` | ${row.duplicates?.join(' / ') ?? 'N/A'} | ${limits || 'No measured loss of the tested duplicate-header guarantee.'} |`;
        })
        .join('\n')}`
    : '';
  const section = `<!-- tested-environments:start -->\n\n## Tested environments\n\n| Area | Environment or behavior |\n| --- | --- |\n${environments[directory].map(([area, value]) => `| ${area} | ${value} |`).join('\n')}${runtimeEvidence}\n\n<!-- tested-environments:end -->`;
  const formatted = await format(
    file,
    `# ${manifest.name}\n\n${navigation}\n\n${body}\n\n${section}\n`,
    configuration.fmt,
  );
  assert.deepEqual(formatted.errors, []);
  if (process.argv.includes('--check')) {
    assert.equal(
      source,
      formatted.code,
      'Package README drift; run pnpm docs:packages: ' + directory,
    );
  } else {
    writeFileSync(file, formatted.code);
  }
}
