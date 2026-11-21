import { loadConfig, normalizeOptions, runCheck } from 'jsdoc-lint';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

test.each(['ts', 'mts'])(
  'checks a targeted TypeScript script without its own package: %s',
  (extension) => {
    const root = mkdtempSync(join(tmpdir(), 'serverless-jwt-jsdoc-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"name":"script-consumer","private":true}');
      mkdirSync(join(root, 'scripts'));
      const script = join(root, `scripts/undocumented.${extension}`);
      writeFileSync(script, `export const undocumented: string = 'probe';\n`);
      const config = JSON.parse(readFileSync(new URL('../jsdoc.json', import.meta.url), 'utf8'));
      writeFileSync(join(root, 'jsdoc.json'), JSON.stringify(config));
      const loaded = loadConfig({ cwd: root });
      const result = runCheck(
        normalizeOptions({
          cwd: root,
          workspaceRoot: root,
          config: loaded.config,
          targets: [script],
        }),
      );
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].relativeFilePath).toBe(`scripts/undocumented.${extension}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
