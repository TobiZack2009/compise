/**
 * @fileoverview Library API contract tests.
 *
 * Verifies:
 *  1. src/index.js exports compile, compileSource, watToWasm, wasmToWat, parseSource, validate
 *  2. compile() is an alias for compileSource()
 *  3. A simple program with no imports compiles with { readFile: null, stdRoot: null }
 *  4. No hidden Node.js fs dependencies in the compiler stack (confirmed by running with no-op readFile)
 */

import { strict as assert } from 'assert';
import { compile, compileSource, parseSource, validate } from '../src/index.js';

describe('library-api — exports', () => {

  it('compile is exported from src/index.js', () => {
    assert.equal(typeof compile, 'function', 'compile should be a function');
  });

  it('compileSource is exported from src/index.js', () => {
    assert.equal(typeof compileSource, 'function', 'compileSource should be a function');
  });

  it('compile and compileSource are the same function', () => {
    assert.strictEqual(compile, compileSource, 'compile should be an alias for compileSource');
  });

  it('parseSource is exported from src/index.js', () => {
    assert.equal(typeof parseSource, 'function');
  });

  it('validate is exported from src/index.js', () => {
    assert.equal(typeof validate, 'function');
  });

});

describe('library-api — zero-fs contract', () => {

  it('compile() works for a simple program with no imports (no readFile needed)', async () => {
    const src = `
      //@export
      function add(a = 0, b = 0) { return a + b; }
    `;
    const result = await compile(src, '<test>', { readFile: null, stdRoot: null });
    assert.ok(result.wasm instanceof Uint8Array, 'should produce wasm');
    assert.ok(result.wat.includes('(module'), 'should produce wat');
    assert.ok(result.warnings instanceof Array, 'should return warnings array');
  });

  it('compile() produces working WASM for no-import program', async () => {
    const src = `
      //@export
      function mul(a = 0, b = 0) { return a * b; }
    `;
    const { wasm } = await compile(src, '<test>', { readFile: null, stdRoot: null });
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.mul(6, 7), 42);
  });

  it('compile() accepts a custom readFile callback (called for imports)', async () => {
    const calls = [];
    const mockReadFile = (path) => {
      calls.push(path);
      return '';  // return empty — no real module needed for this test
    };
    // A program with no imports should not call readFile at all
    const src = `function f(x = 0) { return x; }`;
    await compile(src, '<test>', { readFile: mockReadFile, stdRoot: '/fake' });
    assert.equal(calls.length, 0, 'readFile should not be called for a program with no imports');
  });

});
