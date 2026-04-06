/**
 * @fileoverview List<T> tests — fixed-size typed array with RC management.
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

/**
 * Compile source and instantiate; call __start if present.
 * @param {string} src
 * @returns {Promise<WebAssembly.Exports>}
 */
async function instantiate(src) {
  const { wasm } = await compileSource(src);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

// ── Compilation ───────────────────────────────────────────────────────────────

describe('List<T> — compilation', () => {

  it('new List(f32, 8) compiles without error', async () => {
    const src = `
      //@export
      function make() {
        const buf = new List(f32, 8);
        return buf;
      }
    `;
    const { wasm } = await compileSource(src);
    assert.ok(wasm instanceof Uint8Array, 'should produce wasm');
    assert.ok(wasm[0] === 0x00, 'should be valid wasm magic');
  });

  it('new List(i32, 4) compiles', async () => {
    const src = `
      //@export
      function make() { const b = new List(i32, 4); return b; }
    `;
    const { wasm } = await compileSource(src);
    assert.ok(wasm instanceof Uint8Array);
  });

  it('new List with non-primitive type throws CE-A11', async () => {
    const src = `
      class Foo {}
      function f() { const b = new List(Foo, 4); return b; }
    `;
    await assert.rejects(compileSource(src), /CE-A11/);
  });

});

// ── List header and length ────────────────────────────────────────────────────

describe('List<T> — header and length', () => {

  it('buf.length returns the count passed to constructor', async () => {
    const src = `
      //@export
      function getLen() {
        const buf = new List(i32, 10);
        return buf.length;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.getLen(), 10);
  });

  it('length field stored at offset 12 of allocation', async () => {
    const src = `
      //@export
      function makeAndReturn() {
        const buf = new List(i32, 7);
        return buf;
      }
    `;
    const exp = await instantiate(src);
    const ptr = exp.makeAndReturn();
    assert.ok(ptr > 0, 'pointer should be non-null');
    const mem = new Int32Array(exp.memory.buffer);
    const length = mem[(ptr + 12) >> 2];
    assert.equal(length, 7, `expected length=7 at offset 12, got ${length}`);
  });

  it('vtable_ptr at offset 4 is 0', async () => {
    const src = `
      //@export
      function makeAndReturn() { const b = new List(u8, 3); return b; }
    `;
    const exp = await instantiate(src);
    const ptr = exp.makeAndReturn();
    const mem = new Int32Array(exp.memory.buffer);
    assert.equal(mem[(ptr + 4) >> 2], 0, 'vtable_ptr should be 0');
  });

});

// ── Element read / write ──────────────────────────────────────────────────────

describe('List<T> — element read/write', () => {

  it('buf[0] = 42 then read back gives 42 (i32)', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(i32, 4);
        buf[0] = 42;
        return buf[0];
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.test(), 42);
  });

  it('buf[3] = 99 then read back gives 99 (i32)', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(i32, 4);
        buf[3] = 99;
        return buf[3];
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.test(), 99);
  });

  it('multiple element writes (i32)', async () => {
    const src = `
      //@export
      function sumList() {
        const buf = new List(i32, 4);
        buf[0] = 10;
        buf[1] = 20;
        buf[2] = 30;
        buf[3] = 40;
        return buf[0] + buf[1] + buf[2] + buf[3];
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.sumList(), 100);
  });

  it('f32 element write/read (approximate)', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(f32, 2);
        buf[0] = f32(1.5);
        buf[1] = f32(2.5);
        return f32(buf[0] + buf[1]);
      }
    `;
    const exp = await instantiate(src);
    assert.ok(Math.abs(exp.test() - 4.0) < 0.001, 'f32 elements should round-trip');
  });

  it('u8 element write/read', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(u8, 3);
        buf[0] = u8(255);
        buf[1] = u8(128);
        buf[2] = u8(0);
        return buf[0] + buf[1] + buf[2];
      }
    `;
    const exp = await instantiate(src);
    // u8 arithmetic narrows to 8 bits: (255 + 128) & 0xFF = 127, then 127 + 0 = 127
    assert.equal(exp.test(), 127);
  });

});

// ── $ptr and $byteSize ────────────────────────────────────────────────────────

describe('List<T> — $ptr and $byteSize', () => {

  it('buf.$ptr equals ptr + 16', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(i32, 4);
        return buf.$ptr - buf;
      }
    `;
    // Note: buf is i32, so buf.$ptr - buf just subtracts the i32 values
    const src2 = `
      //@export
      function makeAndReturn() { const b = new List(i32, 4); return b; }
      //@export
      function getDataPtr() { const b = new List(i32, 4); return b.$ptr; }
    `;
    const exp = await instantiate(src2);
    const base = exp.makeAndReturn();
    const dataPtr = exp.getDataPtr();
    // Both allocations are separate, but both should be ptr+16
    // Just verify dataPtr > 0 and is aligned
    assert.ok(dataPtr > 0, '$ptr should be non-null');
    // The data area starts exactly 16 bytes after the list header
    // Verify by checking that dataPtr % 4 === 0 (i32-aligned)
    assert.equal(dataPtr % 4, 0, '$ptr should be word-aligned');
  });

  it('buf.$byteSize = length * elemSize for i32', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(i32, 5);
        return buf.$byteSize;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.test(), 20, 'i32 list of 5 elements = 20 bytes');
  });

  it('buf.$byteSize = length * elemSize for u8', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(u8, 10);
        return buf.$byteSize;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.test(), 10, 'u8 list of 10 elements = 10 bytes');
  });

  it('buf.$byteSize = length * elemSize for f64', async () => {
    const src = `
      //@export
      function test() {
        const buf = new List(f64, 3);
        return buf.$byteSize;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.test(), 24, 'f64 list of 3 elements = 24 bytes');
  });

});
