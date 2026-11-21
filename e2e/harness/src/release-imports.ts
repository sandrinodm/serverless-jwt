import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor } from 'vite-plus';

/**
 * A literal runtime import retains its actual importing file, complete subpath and native
 * conditions.
 */
export interface InternalImport {
  /**
   * Canonical source or compiled importing module, rather than its package manifest.
   */
  readonly importer: string;

  /**
   * Complete internal package specifier, including an exported subpath.
   */
  readonly specifier: string;

  /**
   * Node applies import and require export conditions independently.
   */
  readonly mode: 'import' | 'require';
}

/**
 * Reads decoded AST strings, including escaped literal and expression-free template imports.
 */
function literal(node: unknown): string | undefined {
  const value = node as
    | {
        readonly type?: string;
        readonly value?: unknown;
        readonly expressions?: ReadonlyArray<unknown>;
        readonly quasis?: ReadonlyArray<{ readonly value: { readonly cooked?: string | null } }>;
      }
    | undefined;
  if (value?.type === 'Literal' && typeof value.value === 'string') {
    return value.value;
  }

  if (value?.type === 'TemplateLiteral' && value.expressions?.length === 0) {
    return value.quasis?.[0]?.value.cooked ?? undefined;
  }

  return undefined;
}

/**
 * Locates decoded literal namespace candidates before allocating unrelated SDK parse trees.
 * Unicode/hex, legacy CommonJS octal, identity escapes and line continuations cannot hide a
 * literal.
 */
function namespaceCandidate(source: string): boolean {
  if (source.includes('@serverless-jwt/')) {
    return true;
  }

  return source
    .replace(
      /\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2}))/giu,
      (
        _match,
        point: string | undefined,
        unicode: string | undefined,
        hex: string | undefined,
      ): string => {
        const code = Number.parseInt(point ?? unicode ?? hex ?? '', 16);
        return code <= 127 ? String.fromCodePoint(code) : '';
      },
    )
    .replace(/\\(?:\r\n|[\r\n])/gu, '')
    .replace(/\\([0-3]?[0-7]{1,2})/gu, (_match, octal: string): string =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    )
    .replace(/\\([\s\S])/gu, '$1')
    .includes('@serverless-jwt/');
}

/**
 * Parses a dynamic import's native expression span separately, bounding AST size to that
 * expression.
 */
function dynamicLiteral(source: string): string | undefined {
  const result = parseSync('dynamic.mjs', '(' + source + ')', { preserveParens: false });
  if (result.errors.length) {
    return undefined;
  }

  const expression = result.program.body[0];
  return expression?.type === 'ExpressionStatement' ? literal(expression.expression) : undefined;
}

/**
 * Enumerates executable package imports with the parser already used by the native fixture tooling.
 */
function importsFrom(
  files: ReadonlyArray<string>,
  includeRelative: boolean,
): ReadonlyArray<InternalImport> {
  const imports = new Map<string, InternalImport>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!includeRelative && !namespaceCandidate(source)) {
      continue;
    }

    const parsed = parseSync(file, source, { sourceType: 'unambiguous' });
    /**
     * Keeps only public runtime imports, never parser diagnostics or source text in error output.
     */
    const add = (specifier: string | undefined, mode: 'import' | 'require'): void => {
      if (
        specifier?.startsWith('@serverless-jwt/') ||
        (includeRelative && specifier?.startsWith('.'))
      ) {
        assert.equal(parsed.errors.length, 0, 'Internal importing module could not be parsed');
        imports.set(file + '#' + mode + '#' + specifier, { importer: file, specifier, mode });
      }
    };
    for (const imported of parsed.module.staticImports) {
      if (imported.entries.length === 0 || imported.entries.some((entry) => !entry.isType)) {
        add(imported.moduleRequest.value, 'import');
      }
    }

    for (const exported of parsed.module.staticExports) {
      for (const entry of exported.entries) {
        if (!entry.isType) {
          add(entry.moduleRequest?.value, 'import');
        }
      }
    }

    for (const dynamic of parsed.module.dynamicImports) {
      add(
        dynamicLiteral(source.slice(dynamic.moduleRequest.start, dynamic.moduleRequest.end)),
        'import',
      );
    }

    // Native module records and expression spans avoid whole-AST expansion of unrelated SDK bundles.
    if (source.includes('require') || source.includes('createRequire')) {
      const requireNames = new Set(['require']);
      new Visitor({
        VariableDeclarator(node): void {
          if (
            node.id.type === 'Identifier' &&
            node.init?.type === 'CallExpression' &&
            node.init.callee.type === 'Identifier' &&
            node.init.callee.name === 'createRequire'
          ) {
            requireNames.add(node.id.name);
          }
        },
        CallExpression(node): void {
          const callee = node.callee;
          if (
            (callee.type === 'Identifier' && requireNames.has(callee.name)) ||
            (callee.type === 'MemberExpression' &&
              callee.object.type === 'Identifier' &&
              requireNames.has(callee.object.name) &&
              ((callee.property.type === 'Identifier' && callee.property.name === 'resolve') ||
                literal(callee.property) === 'resolve'))
          ) {
            add(literal(node.arguments[0]), 'require');
          }
        },
      }).visit(parsed.program);
    }
  }

  return [...imports.values()];
}

/**
 * Finds internal package requests without parsing unrelated third-party modules.
 */
export function internalImports(files: ReadonlyArray<string>): ReadonlyArray<InternalImport> {
  return importsFrom(files, false);
}

/**
 * Native traced runtime subsets must retain every statically reachable relative and internal file.
 */
export function runtimeImports(files: ReadonlyArray<string>): ReadonlyArray<InternalImport> {
  return importsFrom(files, true);
}

/**
 * Uses Node's actual ESM resolver parent argument and CommonJS resolver without executing
 * consumers.
 */
export function resolvedInternalImports(
  imports: ReadonlyArray<InternalImport>,
): ReadonlyArray<InternalImport & { readonly resolved: string }> {
  if (!imports.length) {
    return [];
  }

  const script = `import {readFileSync} from 'node:fs'; import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url';
const requests=JSON.parse(readFileSync(0,'utf8')); const results=requests.map(request=>{try{return {...request,resolved:request.mode==='import'?import.meta.resolve(request.specifier,pathToFileURL(request.importer).href):pathToFileURL(createRequire(request.importer).resolve(request.specifier)).href}}catch{return {...request,resolved:null}}}); process.stdout.write(JSON.stringify(results));`;
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      ['--experimental-import-meta-resolve', '--input-type=module', '-e', script],
      {
        input: JSON.stringify(imports),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch {
    throw new Error('Native internal import resolution failed');
  }

  const results = JSON.parse(output) as ReadonlyArray<
    InternalImport & { readonly resolved: string | null }
  >;
  return results.map((entry) => {
    assert.ok(entry.resolved, 'Executable importer could not resolve its internal package');
    assert.ok(
      entry.resolved.startsWith('file:'),
      'Executable importer could not resolve its internal package',
    );
    return { ...entry, resolved: realpathSync(fileURLToPath(entry.resolved)) };
  });
}
