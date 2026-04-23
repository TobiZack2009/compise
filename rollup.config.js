/**
 * Rollup config — bundles the Compise compiler for browser use.
 *
 * Output: dist/compise.esm.js (single ESM file, ~9MB, fully self-contained)
 *
 * Usage in browser (ES module):
 *   import { compile, generateBridge } from './dist/compise.esm.js';
 *
 * To build:
 *   npm run build:lib
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import nodePolyfills from 'rollup-plugin-node-polyfills';

const require = createRequire(import.meta.url);

/**
 * Plugin: adds an ESM default export shim to UMD modules (wabt) that
 * rollup cannot statically analyze as having a default export.
 */
function umdShim(packageName) {
  const resolved = require.resolve(packageName);
  return {
    name: `umd-shim:${packageName}`,
    load(id) {
      if (id !== resolved) return null;
      const src = readFileSync(id, 'utf-8');
      // Detect the module-level var name by looking at the UMD guard
      const m = src.match(/module\.exports\s*=\s*(\w+)\s*;/);
      if (!m) return null;
      const varName = m[1];
      return src + `\nexport default ${varName};\n`;
    },
  };
}

export default {
  input: 'src/index.js',

  output: {
    file: 'dist/compise.esm.js',
    format: 'esm',
    // Preserve import.meta (binaryen uses it for WASM loading)
    inlineDynamicImports: true,
  },

  plugins: [
    // Inject ESM default export into wabt's UMD bundle
    umdShim('wabt'),

    // Replace typeof process to force browser mode in binaryen/wabt.
    // This eliminates all Node.js code paths at bundle time so
    // require('fs'), __dirname, etc. are dead code and never reached.
    replace({
      preventAssignment: true,
      values: {
        // Force browser mode for emscripten-generated code
        "typeof process !== 'undefined' && process.versions && process.versions.node":
          'false',
        // wabt uses a slightly different check
        "globalThis.process?.versions?.node": 'undefined',
      },
    }),

    // Provide browser-compatible shims for Node.js built-ins
    // (needed because rollup statically transforms require() calls)
    nodePolyfills(),

    // Resolve modules from node_modules
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),

    // Convert CommonJS modules (binaryen, wabt) to ESM.
    // Must include node_modules explicitly — rollup skips them by default.
    commonjs({
      include: /node_modules/,
      ignoreDynamicRequires: true,
      requireReturnsDefault: 'auto',
    }),
  ],

  // Silence circular dependency warnings from binaryen/wabt internals
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    if (warning.code === 'EVAL') return;
    warn(warning);
  },
};
