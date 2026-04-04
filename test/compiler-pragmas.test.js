/**
 * @fileoverview Mocha driver for compiler::test pragma files.
 *
 * Discovers every *.js file inside test/pragmas/ (recursively), checks for the
 * `//# compiler::test` header, extracts the inline assertions, and registers
 * one `it()` per assertion.  Files that lack the header are silently skipped —
 * this lets us place helper / shared modules alongside pragma files without
 * them being treated as test sources.
 *
 * Assertion labels come from the pragma runner (pragmas.js) and look like:
 *   "type.infer {isize}  ← const intLiteral0 = 0;"
 *
 * Falling back to normal compilation: tests that require WASM execution (runtime
 * behaviour, WASI integration, etc.) live in their own mocha files and continue
 * to use compileSource/instantiate directly.  This file is concerned only with
 * static / structural assertions that don't need to run the binary.
 */

import { strict as assert }                  from 'assert';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative }                    from 'path';
import { fileURLToPath }                     from 'url';
import { extractAssertions, runAssertion }   from '../src/pragmas.js';

const ROOT       = fileURLToPath(new URL('..', import.meta.url));
const PRAGMA_DIR = join(ROOT, 'test', 'pragmas');

// ── File discovery (synchronous, at load time so describe/it are registered) ──

/**
 * Recursively collect all *.js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results.sort();
}

const pragmaFiles = collectFiles(PRAGMA_DIR);

// ── Register describe/it blocks at load time ──────────────────────────────────

for (const filepath of pragmaFiles) {
  const source     = readFileSync(filepath, 'utf8');
  const { isTestFile, assertions } = extractAssertions(source);

  // Skip files that don't carry the //# compiler::test header.
  if (!isTestFile || assertions.length === 0) continue;

  const label = relative(ROOT, filepath); // e.g. "test/pragmas/typecheck.js"

  describe(`pragma: ${label}`, () => {
    for (const assertion of assertions) {
      it(assertion.label, async () => {
        const result = await runAssertion(assertion, source, filepath);
        assert.ok(result.pass, result.reason);
      });
    }
  });
}
