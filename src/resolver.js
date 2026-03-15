/**
 * @fileoverview Browser-safe module resolver for js.wat.
 * Implements §27 module resolution algorithm.
 * No Node.js imports — accepts readFile and parseSource callbacks.
 */

// ── Path helpers (no fs/path imports) ────────────────────────────────────────

/**
 * Normalize a path (resolve . and .. segments, collapse multiple slashes).
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  const parts = p.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length > 1) out.pop();
    } else if (part !== '.') {
      if (part !== '' || out.length === 0) out.push(part);
    }
  }
  return out.join('/');
}

/**
 * Join path segments and normalize.
 * @param {...string} parts
 * @returns {string}
 */
function joinPath(...parts) {
  return normalizePath(parts.join('/'));
}

/**
 * Get the directory part of a path.
 * @param {string} p
 * @returns {string}
 */
function dirnamePath(p) {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '.';
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ResolveError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string} from
   * @param {string} specifier
   */
  constructor(code, message, from, specifier) {
    super(`${code}: ${message}\n  in ${from}\n  importing '${specifier}'`);
    this.code = code;
    this.from = from;
    this.specifier = specifier;
  }
}

// ── Module Resolver ───────────────────────────────────────────────────────────

/**
 * Browser-safe module resolver.
 * Given an entry AST, collects all transitive dependencies in dep-first order.
 */
export class ModuleResolver {
  /**
   * @param {string} stdRoot  absolute path to std/ directory (no trailing slash)
   * @param {(absolutePath: string) => string} readFile  synchronous file reader
   * @param {(source: string, filename: string) => object} parseSource  parser
   */
  constructor(stdRoot, readFile, parseSource) {
    this._stdRoot  = stdRoot;
    this._readFile = readFile;
    this._parse    = parseSource;
  }

  /**
   * Resolve a specifier to an absolute path.
   * @param {string} spec
   * @param {string} importingFile
   * @returns {string}
   */
  resolveSpecifier(spec, importingFile) {
    if (spec.startsWith('std/')) {
      const rel = spec.slice('std/'.length);
      return joinPath(this._stdRoot, rel.endsWith('.js') ? rel : rel + '.js');
    }
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const base = dirnamePath(importingFile);
      return joinPath(base, spec.endsWith('.js') ? spec : spec + '.js');
    }
    throw new ResolveError('CE-M03',
      `bare specifier '${spec}' not allowed`,
      importingFile, spec);
  }

  /**
   * Collect all transitive dependencies in dep-first order (deepest deps first).
   * The entry file itself is NOT included in the result.
   *
   * @param {object} entryAst  parsed AST of the entry file
   * @param {string} entryFilename  absolute path of entry file
   * @returns {Array<{ source: string, filename: string }>}
   */
  collectDeps(entryAst, entryFilename) {
    /** @type {Set<string>} fully processed absolute paths */
    const visited = new Set();
    /** @type {Set<string>} currently on DFS stack (cycle detection) */
    const visiting = new Set();
    /** @type {Map<string, string>} filename → source */
    const sources = new Map();
    /** @type {string[]} dep-first ordered list of filenames (entry excluded) */
    const orderList = [];

    const self = this;

    /**
     * @param {object} ast
     * @param {string} filename
     */
    function visit(ast, filename) {
      if (visited.has(filename)) return;
      if (visiting.has(filename)) {
        const from = [...visiting].at(-1) ?? filename;
        throw new ResolveError('CE-M02', `import cycle detected`, from, filename);
      }

      visiting.add(filename);

      for (const spec of collectImportSpecifiers(ast)) {
        const resolvedPath = self.resolveSpecifier(spec, filename);
        if (visited.has(resolvedPath)) continue;

        // Read the dependency
        let depSource;
        try {
          depSource = self._readFile(resolvedPath);
        } catch (/** @type {any} */ _e) {
          throw new ResolveError('CE-M01',
            `module not found: '${resolvedPath}'`,
            filename, spec);
        }
        sources.set(resolvedPath, depSource);

        // Parse the dependency
        let depAst;
        try {
          depAst = self._parse(depSource, resolvedPath);
        } catch (/** @type {any} */ e) {
          throw new Error(`Error in module '${resolvedPath}':\n  ${e.message}`);
        }

        // Recurse into dep's own imports first (depth-first)
        visit(depAst, resolvedPath);
      }

      visiting.delete(filename);
      visited.add(filename);

      // Add in post-order (deps before dependents), but skip the entry file
      if (filename !== entryFilename) {
        orderList.push(filename);
      }
    }

    visit(entryAst, entryFilename);

    return orderList.map(f => ({ source: sources.get(f) ?? '', filename: f }));
  }
}

/**
 * Collect all import specifiers from an AST (static ImportDeclarations only).
 * @param {object} ast
 * @returns {string[]}
 */
function collectImportSpecifiers(ast) {
  const specs = [];
  for (const node of ast.body ?? []) {
    if (node.type === 'ImportDeclaration' && typeof node.source?.value === 'string') {
      specs.push(node.source.value);
    }
  }
  return specs;
}
