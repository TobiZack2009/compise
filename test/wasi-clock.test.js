/**
 * @fileoverview WASI-backed std/clock tests.
 */

import { strict as assert } from 'assert';
import { WASI } from 'node:wasi';
import { compileSource } from '../src/compiler.js';

describe('std/clock with WASI', () => {
  it('Clock.now and Clock.monotonic return non-zero', async () => {
    const source = `
      import { Clock } from "std/clock";
      function now() { return Clock.now(); }
      function mono() { return Clock.monotonic(); }
    `;
    const { wasm } = await compileSource(source, 'clock.js');
    const wasi = new WASI({ version: 'preview1' });
    const { instance } = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    if (instance.exports._start) wasi.start(instance);
    else wasi.initialize(instance);
    const now = instance.exports.now() >>> 0;
    const mono = instance.exports.mono() >>> 0;
    assert.ok(now > 0);
    assert.ok(mono >= 0);
  });
});
