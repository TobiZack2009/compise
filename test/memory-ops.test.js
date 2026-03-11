/**
 * @fileoverview Memory ops tests (load/store/copy/fill).
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

describe('memory ops', () => {
  it('i32.store/i32.load round trip', async () => {
    const source = `
      function roundTrip(x = 0) {
        i32.store(0, x);
        return i32.load(0);
      }
    `;
    const { wasm } = await compileSource(source, 'mem.js');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.roundTrip(123), 123);
  });

  it('memory.fill and memory.copy work', async () => {
    const source = `
      function fillAndCopy() {
        memory.fill(0, 65, 4);
        memory.copy(4, 0, 4);
        return i32.load(4);
      }
    `;
    const { wasm } = await compileSource(source, 'mem.js');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.fillAndCopy(), 0x41414141);
  });
});
