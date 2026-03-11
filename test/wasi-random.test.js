/**
 * @fileoverview WASI-backed std/random tests.
 */

import { strict as assert } from 'assert';
import { WASI } from 'node:wasi';
import { compileSource } from '../src/compiler.js';

describe('std/random with WASI', () => {
  it('Random.float returns value in [0,1)', async () => {
    const source = `
      import Random from "std/random";
      function r() { return Random.float(); }
    `;
    const { wasm } = await compileSource(source, 'random.js');
    const wasi = new WASI({ version: 'preview1' });
    const { instance } = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    if (instance.exports._start) wasi.start(instance);
    else wasi.initialize(instance);
    const v = instance.exports.r();
    assert.ok(v >= 0.0 && v < 1.0, `expected [0,1), got ${v}`);
  });
});
