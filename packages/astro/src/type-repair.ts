import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Selects an explicit consumer installation and optional read-only verification.
 */
export interface AstroTypeRepairOptions {
  /**
   * Directory containing the application's package.json; defaults to the working directory.
   */
  readonly root?: string;

  /**
   * Writable project installation boundary; workspace apps explicitly select their workspace root.
   */
  readonly installationRoot?: string;

  /**
   * Verifies that every repair is present without modifying the installation.
   */
  readonly check?: boolean;
}

/**
 * Reports the exact supported SDK and the number of declarations replaced.
 */
export interface AstroTypeRepairResult {
  /**
   * Exact Astro release whose published file inventory was verified.
   */
  readonly version: string;

  /**
   * Number of declaration files replaced by this invocation.
   */
  readonly changed: number;
}

/**
 * Identifies exact distributed bytes using package-relative paths.
 */
interface InventoryFile {
  /**
   * Relative path inside the SDK or immutable repair distribution.
   */
  readonly path: string;

  /**
   * SHA-256 digest of the exact audited file bytes.
   */
  readonly sha256: string;
}

/**
 * Connects an original SDK declaration to its audited replacement payload.
 */
interface DeclarationRepair extends InventoryFile {
  /**
   * Relative location of the audited replacement declaration payload.
   */
  readonly source: string;
}

/**
 * Owns the complete original SDK inventory and audited declaration assets.
 */
interface RepairManifest {
  /**
   * Exact Astro release supported by this repair profile.
   */
  readonly astroVersion: string;

  /**
   * Complete original Astro file inventory checked before any write.
   */
  readonly sdkFiles: ReadonlyArray<InventoryFile>;

  /**
   * Immutable vendored declarations checked against their audited digests.
   */
  readonly assets: ReadonlyArray<InventoryFile>;

  /**
   * Existing Astro declarations replaced by source-faithful payloads.
   */
  readonly repairs: ReadonlyArray<DeclarationRepair>;

  /**
   * Exact storage release and original files protected by preflight checks.
   */
  readonly unstorage: { readonly version: string; readonly files: ReadonlyArray<InventoryFile> };

  /**
   * New storage declarations rendered with the original dependency owners.
   */
  readonly generated: ReadonlyArray<DeclarationRepair>;

  /**
   * Exact markdown release, original files and declaration-only corrections.
   */
  readonly markdown: {
    readonly version: string;
    readonly files: ReadonlyArray<InventoryFile>;
    readonly repairs: ReadonlyArray<DeclarationRepair>;
  };
}

/**
 * Captures preflight-verified destination bytes before any installation mutation.
 */
interface PendingRepair {
  /**
   * Verified physical destination inside the selected SDK installation.
   */
  readonly target: string;

  /**
   * Complete declaration text after resolving its genuine dependency owners.
   */
  readonly content: string;

  /**
   * Indicates that the installed bytes still require replacement.
   */
  readonly changed: boolean;
}

/**
 * Computes a reproducible digest over exact source or installed bytes.
 */
function digest(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Narrows untrusted JSON objects before accessing manifest fields.
 */
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Astro declaration repair manifest');
  }

  return value as Record<string, unknown>;
}

/**
 * Rejects absolute paths, traversal and platform-dependent path separators.
 */
function inventoryFile(value: unknown): InventoryFile {
  const entry = object(value);
  if (
    typeof entry.path !== 'string' ||
    !/^[\w@./-]+$/u.test(entry.path) ||
    isAbsolute(entry.path) ||
    entry.path.split('/').some((part) => part === '..' || part === '.' || part === '') ||
    typeof entry.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(entry.sha256)
  ) {
    throw new Error('Invalid Astro declaration repair file inventory');
  }

  return { path: entry.path, sha256: entry.sha256 };
}

/**
 * Reads and validates the shipped repair contract before resolving application files.
 */
function readManifest(root: string): RepairManifest {
  const value: unknown = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const manifest = object(value);
  if (
    typeof manifest.astroVersion !== 'string' ||
    !Array.isArray(manifest.sdkFiles) ||
    !Array.isArray(manifest.assets) ||
    !Array.isArray(manifest.repairs) ||
    !Array.isArray(manifest.generated)
  ) {
    throw new Error('Invalid Astro declaration repair manifest');
  }

  const unstorage = object(manifest.unstorage);
  if (typeof unstorage.version !== 'string' || !Array.isArray(unstorage.files)) {
    throw new Error('Invalid unstorage declaration repair inventory');
  }

  const markdown = object(manifest.markdown);
  if (
    typeof markdown.version !== 'string' ||
    !Array.isArray(markdown.files) ||
    !Array.isArray(markdown.repairs)
  ) {
    throw new Error('Invalid markdown declaration repair inventory');
  }

  const sdkFiles = manifest.sdkFiles.map(inventoryFile);
  const assets = manifest.assets.map(inventoryFile);
  /**
   * Validates each declaration target and its immutable payload location.
   */
  const declaration = (input: unknown): DeclarationRepair => {
    const entry = object(input);
    const file = inventoryFile(input);
    if (
      typeof entry.source !== 'string' ||
      !(entry.source.startsWith('payloads/') || entry.source.startsWith('vendor/')) ||
      !/\.d\.[cm]?ts$/u.test(file.path)
    ) {
      throw new Error('Repair target must be an existing SDK declaration');
    }

    inventoryFile({ path: entry.source, sha256: file.sha256 });
    return { ...file, source: entry.source };
  };
  const repairs = manifest.repairs.map(declaration);
  const generated = manifest.generated.map(declaration);
  if (
    new Set(sdkFiles.map((file) => file.path)).size !== sdkFiles.length ||
    new Set(assets.map((file) => file.path)).size !== assets.length ||
    new Set(repairs.map((file) => file.path)).size !== repairs.length ||
    repairs.some((repair) => !sdkFiles.some((file) => file.path === repair.path))
  ) {
    throw new Error('Invalid or duplicate Astro declaration repair targets');
  }

  const storageFiles = unstorage.files.map(inventoryFile);
  const markdownFiles = markdown.files.map(inventoryFile);
  const markdownRepairs = markdown.repairs.map(declaration);
  if (
    new Set(markdownFiles.map((file) => file.path)).size !== markdownFiles.length ||
    new Set(markdownRepairs.map((file) => file.path)).size !== markdownRepairs.length ||
    markdownRepairs.some((repair) => !markdownFiles.some((file) => file.path === repair.path)) ||
    new Set(generated.map((file) => file.path)).size !== generated.length ||
    generated.some((repair) => storageFiles.some((file) => file.path === repair.path))
  ) {
    throw new Error('Invalid markdown or generated declaration repair targets');
  }

  return {
    astroVersion: manifest.astroVersion,
    sdkFiles,
    assets,
    repairs,
    generated,
    markdown: { version: markdown.version, files: markdownFiles, repairs: markdownRepairs },
    unstorage: { version: unstorage.version, files: storageFiles },
  };
}

/**
 * Resolves an existing file while containing symlinks within its owning package.
 */
function contained(root: string, path: string): string {
  const target = realpathSync(join(root, path));
  const location = relative(root, target);
  if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new Error('Astro declaration repair file escapes its package');
  }

  return target;
}

/**
 * Restricts SDK lookups to real directories owned by the explicit installation.
 */
function assertSdkLocation(nodeModules: string, directory: string): void {
  const location = relative(nodeModules, directory);
  if (!location || location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new Error('SDK or repair package is outside the explicit installation node_modules');
  }
}

/**
 * Locates a dependency package without depending on an exported package.json subpath.
 */
function packageRoot(
  owner: ReturnType<typeof createRequire>,
  name: string,
  nodeModules?: string,
): string {
  let directory: string;
  try {
    directory = dirname(realpathSync(owner.resolve(`${name}/package.json`)));
  } catch {
    directory = dirname(realpathSync(owner.resolve(name)));
  }

  while (true) {
    if (nodeModules !== undefined) {
      assertSdkLocation(nodeModules, directory);
    }

    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const path = nodeModules === undefined ? manifest : contained(directory, 'package.json');
      const value = object(JSON.parse(readFileSync(path, 'utf8')) as unknown);
      if (value.name === name) {
        return directory;
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot locate declaration repair dependency: ${name}`);
    }

    directory = parent;
  }
}

/**
 * Converts a real type-owner file to a declaration-relative module specifier.
 */
function specifier(target: string, source: string): string {
  const path = relative(dirname(target), source).replaceAll('\\', '/');
  return path.startsWith('.') ? path : `./${path}`;
}

/**
 * Explicitly repairs the audited Astro declaration graph without changing runtime files. Run this
 * after dependency installation; package imports never invoke it automatically.
 */
export function repairAstroTypes(options: AstroTypeRepairOptions = {}): AstroTypeRepairResult {
  const modulePath = fileURLToPath(import.meta.url);
  const ownRoot = dirname(dirname(modulePath));
  const distribution = realpathSync(
    join(ownRoot, modulePath.endsWith('.ts') ? 'type-repair' : 'dist/type-repair'),
  );
  const manifest = readManifest(distribution);
  const root = realpathSync(resolve(options.root ?? process.cwd()));
  const installation = realpathSync(resolve(options.installationRoot ?? root));
  const applicationManifest = contained(root, 'package.json');
  const appLocation = relative(installation, root);
  if (appLocation.startsWith('..') || isAbsolute(appLocation)) {
    throw new Error('Application is outside the explicit installation boundary');
  }

  const consumer = createRequire(applicationManifest);
  const nodeModules = join(installation, 'node_modules');
  const packagePath = realpathSync(consumer.resolve('astro/package.json'));
  const sdkRoot = dirname(packagePath);
  assertSdkLocation(nodeModules, sdkRoot);
  const adapterPath = realpathSync(consumer.resolve('@serverless-jwt/astro/package.json'));
  if (adapterPath !== realpathSync(join(ownRoot, 'package.json'))) {
    throw new Error('Invoke the declaration repair from the application installation');
  }

  const sdkPackage = object(JSON.parse(readFileSync(packagePath, 'utf8')) as unknown);
  if (sdkPackage.version !== manifest.astroVersion) {
    throw new Error('Unsupported Astro version for declaration repair');
  }

  const storageRoot = packageRoot(createRequire(packagePath), 'unstorage', nodeModules);
  const storagePackage = object(
    JSON.parse(readFileSync(contained(storageRoot, 'package.json'), 'utf8')) as unknown,
  );
  if (storagePackage.version !== manifest.unstorage.version) {
    throw new Error('Unsupported unstorage version for declaration repair');
  }

  for (const immutable of [ownRoot, distribution]) {
    const location = relative(installation, immutable);
    if (location.startsWith('..') || isAbsolute(location)) {
      throw new Error('Repair package is outside the explicit installation boundary');
    }
  }

  const peers = createRequire(import.meta.url);
  const markdownRoot = packageRoot(peers, '@astrojs/markdown-remark');
  const markdownPackage = object(
    JSON.parse(readFileSync(join(markdownRoot, 'package.json'), 'utf8')) as unknown,
  );
  if (
    markdownPackage.version !== manifest.markdown.version ||
    packageRoot(consumer, '@astrojs/markdown-remark') !== markdownRoot ||
    packageRoot(createRequire(packagePath), '@astrojs/markdown-remark') !== markdownRoot
  ) {
    throw new Error('Unsupported application markdown type-peer identity');
  }

  const markdownLocation = relative(join(installation, 'node_modules'), markdownRoot);
  if (markdownLocation.startsWith('..') || isAbsolute(markdownLocation)) {
    throw new Error('Markdown type peer is outside the installation boundary');
  }

  const astEntries = new Map<string, string>();
  for (const [name, version, token] of [
    ['@types/unist', '3.0.3', '__SERVERLESS_JWT_UNIST__'],
    ['@types/hast', '3.0.5', '__SERVERLESS_JWT_HAST__'],
    ['@types/mdast', '4.0.4', '__SERVERLESS_JWT_MDAST__'],
  ] as const) {
    const peerRoot = packageRoot(peers, name);
    const peer = object(
      JSON.parse(readFileSync(join(peerRoot, 'package.json'), 'utf8')) as unknown,
    );
    const location = relative(join(installation, 'node_modules'), peerRoot);
    if (
      peer.version !== version ||
      location.startsWith('..') ||
      isAbsolute(location) ||
      packageRoot(consumer, name) !== peerRoot
    ) {
      throw new Error('Unsupported application AST type-peer identity');
    }

    astEntries.set(token, contained(peerRoot, 'index.d.ts'));
  }

  const mongoRoot = packageRoot(peers, 'mongodb');
  const redisRoot = packageRoot(peers, 'ioredis');
  for (const [name, peerRoot] of [
    ['mongodb', mongoRoot],
    ['ioredis', redisRoot],
  ] as const) {
    const location = relative(join(installation, 'node_modules'), peerRoot);
    if (
      location.startsWith('..') ||
      isAbsolute(location) ||
      packageRoot(consumer, name) !== peerRoot
    ) {
      throw new Error('Nominal storage peers must belong to the application installation');
    }
  }

  const mongoPackage = object(
    JSON.parse(readFileSync(join(mongoRoot, 'package.json'), 'utf8')) as unknown,
  );
  const redisPackage = object(
    JSON.parse(readFileSync(join(redisRoot, 'package.json'), 'utf8')) as unknown,
  );
  if (mongoPackage.version !== '7.8.0' || redisPackage.version !== '5.11.1') {
    throw new Error('Unsupported nominal storage type-peer version');
  }

  const mongo = contained(mongoRoot, 'mongodb.d.ts');
  const redis = contained(redisRoot, 'built/index.d.ts');
  for (const asset of manifest.assets) {
    if (digest(readFileSync(contained(distribution, asset.path))) !== asset.sha256) {
      throw new Error(`Unexpected Astro declaration repair asset: ${asset.path}`);
    }
  }

  const generated = manifest.generated.map((repair): PendingRepair => {
    const parent = realpathSync(dirname(join(storageRoot, repair.path)));
    const target = join(parent, basename(repair.path));
    const location = relative(storageRoot, target);
    if (location.startsWith('..') || isAbsolute(location)) {
      throw new Error('Generated declaration escapes the unstorage package');
    }

    const payload = readFileSync(contained(distribution, repair.source), 'utf8');
    if (digest(payload) !== repair.sha256) {
      throw new Error(`Unexpected Astro declaration repair payload: ${repair.source}`);
    }

    const content = payload
      .replaceAll('__SERVERLESS_JWT_MONGODB__', specifier(target, mongo))
      .replaceAll('__SERVERLESS_JWT_IOREDIS__', specifier(target, redis));
    if (
      existsSync(target) &&
      digest(readFileSync(contained(storageRoot, repair.path))) !== digest(content)
    ) {
      throw new Error(`Unexpected generated unstorage declaration: ${repair.path}`);
    }

    return { target, content, changed: !existsSync(target) };
  });
  const generatedOptions = generated[0];
  if (generatedOptions === undefined || generated.length !== 1) {
    throw new Error('Expected one audited unstorage declaration companion');
  }

  const replacements = new Map<string, PendingRepair>();
  for (const [owner, repairs] of [
    [sdkRoot, manifest.repairs],
    [markdownRoot, manifest.markdown.repairs],
  ] as const) {
    for (const repair of repairs) {
      const target = contained(owner, repair.path);
      const payload = readFileSync(contained(distribution, repair.source), 'utf8');
      if (digest(payload) !== repair.sha256) {
        throw new Error(`Unexpected Astro declaration repair payload: ${repair.source}`);
      }

      let content = payload
        .replaceAll('__SERVERLESS_JWT_VENDOR__', specifier(target, join(distribution, 'vendor')))
        .replaceAll(
          '__SERVERLESS_JWT_OPTIONS__',
          specifier(target, generatedOptions.target.replace(/\.d\.mts$/u, '.mjs')),
        );
      for (const [token, entry] of astEntries) {
        content = content.replaceAll(token, specifier(target, entry));
      }

      replacements.set(target, { target, content, changed: false });
    }
  }

  for (const [root, inventory] of [
    [sdkRoot, manifest.sdkFiles],
    [storageRoot, manifest.unstorage.files],
    [markdownRoot, manifest.markdown.files],
  ] as const) {
    for (const file of inventory) {
      const current = digest(readFileSync(contained(root, file.path)));
      const replacement = replacements.get(contained(root, file.path));
      const repaired = replacement === undefined ? undefined : digest(replacement.content);
      if (current !== file.sha256 && current !== repaired) {
        throw new Error(`Unexpected SDK bytes: ${file.path}`);
      }

      if (replacement !== undefined) {
        replacements.set(replacement.target, { ...replacement, changed: current !== repaired });
      }
    }
  }

  const pending = [...generated, ...replacements.values()].filter((file) => file.changed);
  if (options.check === true && pending.length !== 0) {
    throw new Error('Astro declaration repair has not been applied');
  }

  if (options.check !== true) {
    for (const file of pending) {
      const temporary = `${file.target}.serverless-jwt-${process.pid}.tmp`;
      let created = false;
      try {
        writeFileSync(temporary, file.content, { flag: 'wx' });
        created = true;
        renameSync(temporary, file.target);
      } finally {
        if (created && existsSync(temporary)) {
          unlinkSync(temporary);
        }
      }
    }
  }

  return { version: manifest.astroVersion, changed: pending.length };
}
