/**
 * @fileoverview End-to-end integration tests for the module resolution pipeline.
 * Tests user relative imports (./lib.js), stdlib imports via readFile,
 * and @external user-defined host functions.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../src/compiler.js';

const STD_ROOT = fileURLToPath(new URL('../std', import.meta.url));

/**
 * Build resolver opts backed by an in-memory file map (merged with real std/).
 * Paths in `files` are absolute or relative to the virtual entry file.
 * @param {Record<string, string>} files  absolute-path → source
 */
function makeOpts(files = {}) {
  return {
    readFile: (/** @type {string} */ p) => {
      if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
      // Fall through to real std/ files on disk
      return readFileSync(p, 'utf8');
    },
    stdRoot: STD_ROOT,
  };
}

/**
 * Compile and instantiate, returning the WASM exports.
 * @param {string} src
 * @param {string} filename
 * @param {Record<string, string>} [files]
 * @param {Record<string, any>} [imports]
 */
async function compileAndRun(src, filename, files = {}, imports = {}) {
  const opts = makeOpts(files);
  const { wasm } = await compileSource(src, filename, opts);
  const { instance } = await WebAssembly.instantiate(wasm, imports);
  return instance.exports;
}

// ── std/ imports via readFile ─────────────────────────────────────────────────

describe('imports — std/ via readFile', () => {

  it('compiles std/range import and runs Range for-of', async () => {
    const exports = await compileAndRun(`
      import { Range } from 'std/range';
      //@export
      function sum() {
        let s = 0;
        for (const i of new Range(0, 5)) { s = s + i; }
        return s;
      }
    `, '/entry.js');
    assert.equal(exports.sum(), 10); // 0+1+2+3+4
  });

  it('compiles std/string import', async () => {
    const exports = await compileAndRun(`
      import { Range } from 'std/range';
      //@export
      function count(n = 0) {
        let s = 0;
        for (const i of new Range(0, n)) { s = s + 1; }
        return s;
      }
    `, '/entry.js');
    assert.equal(exports.count(7), 7);
  });

});

// ── User relative imports ─────────────────────────────────────────────────────

describe('imports — user relative imports', () => {

  it('imports a function from ./lib', async () => {
    const exports = await compileAndRun(
      `import { add } from './lib';
       //@export
       function main(x = 0, y = 0) { return add(x, y); }`,
      '/project/main.js',
      {
        '/project/lib.js': `
          //@export
          function add(x = 0, y = 0) { return x + y; }
        `,
      }
    );
    assert.equal(exports.main(3, 4), 7);
  });

  it('imports a constant-returning function', async () => {
    const exports = await compileAndRun(
      `import { answer } from './constants';
       //@export
       function main() { return answer(); }`,
      '/project/main.js',
      {
        '/project/constants.js': `
          //@export
          function answer() { return 42; }
        `,
      }
    );
    assert.equal(exports.main(), 42);
  });

  it('resolves transitive relative imports (a → b → c)', async () => {
    const exports = await compileAndRun(
      `import { a } from './a';
       //@export
       function main() { return a(); }`,
      '/project/main.js',
      {
        '/project/a.js': `import { b } from './b';
          function a() { return b() + 1; }`,
        '/project/b.js': `import { c } from './c';
          function b() { return c() + 10; }`,
        '/project/c.js': `function c() { return 100; }`,
      }
    );
    // 100 + 10 + 1 = 111
    assert.equal(exports.main(), 111);
  });

  it('handles diamond dependency (a,b both import c)', async () => {
    const exports = await compileAndRun(
      `import { a } from './a';
       import { b } from './b';
       //@export
       function main() { return a() + b(); }`,
      '/project/main.js',
      {
        '/project/a.js': `import { base } from './c'; function a() { return base() + 1; }`,
        '/project/b.js': `import { base } from './c'; function b() { return base() + 2; }`,
        '/project/c.js': `function base() { return 10; }`,
      }
    );
    // (10+1) + (10+2) = 23
    assert.equal(exports.main(), 23);
  });

  it('compiles mixed relative + std imports', async () => {
    const exports = await compileAndRun(
      `import { Range } from 'std/range';
       import { repeat } from './utils';
       //@export
       function main() { return repeat(3); }`,
      '/project/main.js',
      {
        '/project/utils.js': `
          import { Range } from 'std/range';
          function repeat(n = 0) {
            let s = 0;
            for (const i of new Range(0, n)) { s = s + 1; }
            return s;
          }
        `,
      }
    );
    assert.equal(exports.main(), 3);
  });

});

// ── Error propagation ─────────────────────────────────────────────────────────

describe('imports — resolver errors propagate', () => {

  it('throws CE-M01 for missing relative import', async () => {
    let err;
    try {
      await compileSource(
        `import { x } from './missing-file';
         function main() { return x(); }`,
        '/project/main.js',
        makeOpts()
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'expected an error');
    assert.ok(err.message.includes('CE-M01') || err.message.includes('not found') || err.message.includes('missing-file'),
      `unexpected error: ${err.message}`);
  });

  it('throws CE-M03 for bare specifier', async () => {
    let err;
    try {
      await compileSource(
        `import { x } from 'some-npm-package';
         function main() { return x(); }`,
        '/project/main.js',
        makeOpts()
      );
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'expected an error');
    assert.ok(err.message.includes('CE-M03') || err.message.includes('bare'),
      `unexpected error: ${err.message}`);
  });

});
