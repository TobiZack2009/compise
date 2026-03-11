/**
 * @fileoverview Allocator smoke tests (bump + free list reuse).
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

describe('allocator (__alloc/__free)', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => {
    const { wasm } = await compileSource('function noop() { }');
    const { instance } = await WebAssembly.instantiate(wasm);
    if (instance.exports.__start) instance.exports.__start();
    exp = instance.exports;
  });

  it('allocates increasing addresses', () => {
    const a = exp.__jswat_alloc(8);
    const b = exp.__jswat_alloc(8);
    assert.ok(b > a, `expected b > a, got a=${a} b=${b}`);
  });

  it('reuses freed blocks', () => {
    const a = exp.__jswat_alloc(16);
    exp.__jswat_free(a, 16);
    const b = exp.__jswat_alloc(16);
    assert.equal(a, b);
  });

  it('alloc_bytes returns data pointer and supports realloc', () => {
    const p = exp.__jswat_alloc_bytes(12, 0);
    const q = exp.__jswat_realloc(p, 12, 24);
    assert.ok(q !== 0, 'expected realloc to return non-zero');
    exp.__jswat_free_bytes(q, 24);
  });
});
