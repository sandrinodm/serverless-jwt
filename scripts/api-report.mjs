import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { format } from 'vite-plus/fmt';

import configuration from '../vite.config.ts';

/**
 * Captures built root exports and their supporting declaration graph without a second API parser.
 */
const packages = readdirSync(resolve('packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    directory: entry.name,
    manifest: JSON.parse(readFileSync(resolve('packages', entry.name, 'package.json'), 'utf8')),
  }))
  .filter(({ manifest }) => manifest.private !== true);
for (const { directory, manifest } of packages) {
  const root = resolve('packages', directory, 'dist');
  for (const publicEntry of Object.keys(manifest.exports).filter(
    (entry) => entry !== './package.json',
  )) {
    const entry = publicEntry === '.' ? 'index' : publicEntry.slice(2);
    const pending = [entry + '.d.mts'];
    const seen = new Set();
    let report = `# ${manifest.name}${publicEntry === '.' ? '' : '/' + entry}\n\nGenerated from the packed declaration graph. Only the root export list defines public names; supporting declarations retain their module context.\n`;
    while (pending.length) {
      const file = pending.shift();
      if (seen.has(file)) {
        continue;
      }

      seen.add(file);
      const declaration = readFileSync(resolve(root, file), 'utf8').trim();
      report += `\n## ${file}\n\n\`\`\`ts\n${declaration}\n\`\`\`\n`;
      for (const match of declaration.matchAll(/from ["'](\.\/[^"']+)\.mjs["']/g)) {
        pending.push(resolve(dirname(file), match[1] + '.d.mts').replace(process.cwd() + '/', ''));
      }

      for (const match of declaration.matchAll(
        /<reference path=["'](\.\/[^"']+\.d\.[cm]?ts)["']/g,
      )) {
        pending.push(resolve(dirname(file), match[1]).replace(process.cwd() + '/', ''));
      }
    }

    const output = resolve(
      'api/' +
        directory +
        (publicEntry === '.' ? '' : '-' + entry.replaceAll('/', '-')) +
        '.api.md',
    );
    const formatted = await format(output, report, configuration.fmt);
    assert.deepEqual(formatted.errors, [], 'Generated API declarations could not be formatted');
    report = formatted.code;
    if (process.argv.includes('--check')) {
      assert.ok(existsSync(output), 'API report is missing; run pnpm api:report after building');
      assert.equal(
        readFileSync(output, 'utf8'),
        report,
        'API report drift; regenerate and review the public change',
      );
    } else {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, report);
    }

    console.log(`Verified API declaration graph (${seen.size} modules).`);
  }
}
