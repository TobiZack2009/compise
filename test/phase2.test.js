/**
 * @fileoverview Phase 2 integration tests (loops, logical ops, assignments, recursion).
 */

import { strict as assert } from 'assert';
import { readFile } from 'fs/promises';
import { compileSource } from '../src/compiler.js';

/**
 * Compile a source file and return the instantiated WASM exports.
 * @param {string} path  path relative to project root
 * @returns {Promise<WebAssembly.Exports>}
 */
// Minimal WASI stubs so examples that import std/io compile without missing imports.
const WASI_STUBS = {
  wasi_snapshot_preview1: {
    fd_write: () => 0, fd_read: () => 0, proc_exit: () => {},
    environ_get: () => 0, environ_sizes_get: () => 0,
  },
};

async function instantiateFile(path) {
  const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  const { wasm } = await compileSource(source, path);
  const { instance } = await WebAssembly.instantiate(wasm, WASI_STUBS);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

describe('examples/loops.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/loops.js'); });

  it('whileSum(5) → 10', () => assert.equal(exp.whileSum(5), 10));
  it('forSum(10) → 18',  () => assert.equal(exp.forSum(10), 18));
  it('doWhileSum(0) → 0',() => assert.equal(exp.doWhileSum(0), 0));
  it('doWhileSum(3) → 3',() => assert.equal(exp.doWhileSum(3), 3));

  it('logicalAnd(1,1) → 1', () => assert.equal(exp.logicalAnd(1, 1), 1));
  it('logicalAnd(1,0) → 0', () => assert.equal(exp.logicalAnd(1, 0), 0));
  it('logicalOr(0,0) → 0',  () => assert.equal(exp.logicalOr(0, 0), 0));
  it('logicalOr(0,2) → 1',  () => assert.equal(exp.logicalOr(0, 2), 1));

  it('compound(10,4) → 4',  () => assert.equal(exp.compound(10, 4), 4));
  it('update(5) → 19',      () => assert.equal(exp.update(5), 19));
});

describe('examples/fibonacci.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/fibonacci.js'); });

  it('fib(0) → 0', () => assert.equal(exp.fib(0), 0));
  it('fib(1) → 1', () => assert.equal(exp.fib(1), 1));
  it('fib(6) → 8', () => assert.equal(exp.fib(6), 8));
});
