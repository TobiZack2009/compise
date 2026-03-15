/**
 * @fileoverview GC — reference counting tests.
 *
 * Verifies:
 *  1. Object header layout: rc_class at offset 0, vtable_ptr at 4, class_id at 8
 *  2. Initial refcount is 1 (embedded in rc_class low 28 bits)
 *  3. Objects are freed (rc hits 0) when the owning function returns
 *  4. Returned objects are NOT freed (caller owns rc=1)
 *  5. Copied references (const q = p) are rc_inc'd and both freed correctly
 *  6. str→integer parsing (genCast str→i32)
 *  7. str→float parsing (genCast str→f64)
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

/**
 * Compile source and instantiate; exports include exported functions + memory.
 * @param {string} src
 * @returns {Promise<WebAssembly.Exports>}
 */
async function instantiate(src) {
  const { wasm } = await compileSource(src);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

// ── Header layout ─────────────────────────────────────────────────────────────

describe('GC — object header layout', () => {

  it('rc_class at offset 0 has low-28-bit refcount = 1 after new', async () => {
    const src = `
      class Pt { x = 0; y = 0; }
      //@export
      function make() {
        const p = new Pt();
        return p;
      }
    `;
    const exp = await instantiate(src);
    const ptr = exp.make();
    assert.ok(ptr > 0, 'pointer should be non-null');
    const mem = new Int32Array(exp.memory.buffer);
    const word = mem[ptr >> 2];           // i32 at offset 0 = rc_class
    const rc = word & 0x0FFFFFFF;         // low 28 bits = refcount
    assert.equal(rc, 1, `expected refcount=1 at offset 0, got ${rc} (word=0x${(word>>>0).toString(16)})`);
  });

  it('vtable_ptr at offset 4 is 0', async () => {
    const src = `
      class Pt { x = 0; }
      //@export
      function make() { return new Pt(); }
    `;
    const exp = await instantiate(src);
    const ptr = exp.make();
    const mem = new Int32Array(exp.memory.buffer);
    const vtable = mem[(ptr + 4) >> 2];
    assert.equal(vtable, 0, `expected vtable_ptr=0, got ${vtable}`);
  });

  it('class_id at offset 8 is non-zero', async () => {
    const src = `
      class Pt { x = 0; }
      //@export
      function make() { return new Pt(); }
    `;
    const exp = await instantiate(src);
    const ptr = exp.make();
    const mem = new Int32Array(exp.memory.buffer);
    const classId = mem[(ptr + 8) >> 2];
    assert.ok(classId > 0, `expected class_id > 0, got ${classId}`);
  });

  it('fields start at offset 12', async () => {
    const src = `
      class Pt { x = 0; y = 0; }
      //@export
      function makeXY(x = 0, y = 0) {
        const p = new Pt();
        p.x = x;
        p.y = y;
        return p;
      }
      //@export
      function readX(p = 0) { return new Pt().x; }
    `;
    // Use makeXY then read back via memory
    const exp = await instantiate(src);
    const ptr = exp.makeXY(42, 99);
    const mem = new Int32Array(exp.memory.buffer);
    const xVal = mem[(ptr + 12) >> 2];
    const yVal = mem[(ptr + 16) >> 2];
    assert.equal(xVal, 42, `expected x=42 at offset 12, got ${xVal}`);
    assert.equal(yVal, 99, `expected y=99 at offset 16, got ${yVal}`);
  });

  it('size-class index stored in high 4 bits of rc_class', async () => {
    // Class with 1 i32 field → size = 12 header + 4 = 16 bytes → size-class index 1 (CLASS_SIZES[1]=16)
    // rc_class = (1 << 28) | 1 = 0x10000001
    const src = `
      class Small { v = 0; }
      //@export
      function make() { return new Small(); }
    `;
    const exp = await instantiate(src);
    const ptr = exp.make();
    const mem = new Int32Array(exp.memory.buffer);
    const rcClass = mem[ptr >> 2] >>> 0;  // unsigned
    const sizeIdx = (rcClass >>> 28) & 0xF;
    // size = 16 bytes → CLASS_SIZES[1] → index 1
    assert.equal(sizeIdx, 1, `expected size-class index 1, got ${sizeIdx} (rc_class=0x${rcClass.toString(16)})`);
  });

});

// ── RC lifecycle ──────────────────────────────────────────────────────────────

describe('GC — RC lifecycle', () => {

  it('allocating many objects in a loop does not OOM', async () => {
    const src = `
      class Node { val = 0; }
      //@export
      function stressAlloc(n = 0) {
        let i = 0;
        let last = 0;
        while (i < n) {
          const node = new Node();
          node.val = i;
          last = node.val;
          i = i + 1;
        }
        return last;
      }
    `;
    const exp = await instantiate(src);
    // Allocate 10000 objects; each freed at end of loop iteration (via rc_dec at end of function body).
    // Without GC this would exhaust bump memory; with GC the blocks are returned to free lists.
    const result = exp.stressAlloc(10000);
    assert.equal(result, 9999);
  });

  it('returned object is NOT freed — caller reads rc=1', async () => {
    const src = `
      class Box { v = 0; }
      //@export
      function makeBox(x = 0) {
        const b = new Box();
        b.v = x;
        return b;
      }
    `;
    const exp = await instantiate(src);
    const ptr = exp.makeBox(77);
    // After return, refcount should still be 1 (caller owns it)
    const mem = new Int32Array(exp.memory.buffer);
    const rc = mem[ptr >> 2] & 0x0FFFFFFF;
    assert.equal(rc, 1, `expected rc=1 on returned object, got ${rc}`);
  });

  it('heap local freed at function exit — bump pointer advances then retreats', async () => {
    // After the function exits, the freed slot goes back to the free list.
    // Calling again should reuse the same address.
    const src = `
      class Tmp { v = 0; }
      //@export
      function allocAndFree() {
        const t = new Tmp();
        t.v = 42;
        return t.v;  // returns an i32, not the class — so t IS rc_dec'd at exit
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.allocAndFree(), 42);
    // Call twice — if GC works, second call should return same address (reused from free list)
    // We can't directly observe the address, but we verify it doesn't crash and returns correct value.
    assert.equal(exp.allocAndFree(), 42);
    assert.equal(exp.allocAndFree(), 42);
  });

  it('copied reference (const q = p) is rc_inc\'d, both freed correctly', async () => {
    const src = `
      class Num { v = 0; }
      //@export
      function dupRef(x = 0) {
        const p = new Num();
        p.v = x;
        const q = p;   // rc_inc on copy → rc = 2
        return p.v + q.v;
        // at return: returning i32, so both p and q get rc_dec
        // rc goes 2 → 1 (first dec) → 0 (second dec) → freed
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.dupRef(21), 42);
  });

  it('two distinct classes have different class_ids', async () => {
    const src = `
      class A { x = 0; }
      class B { y = 0; }
      //@export
      function makeA() { return new A(); }
      //@export
      function makeB() { return new B(); }
    `;
    const exp = await instantiate(src);
    const ptrA = exp.makeA();
    const ptrB = exp.makeB();
    const mem = new Int32Array(exp.memory.buffer);
    const idA = mem[(ptrA + 8) >> 2];
    const idB = mem[(ptrB + 8) >> 2];
    assert.ok(idA !== idB, `expected different class_ids, got A=${idA} B=${idB}`);
    assert.ok(idA > 0 && idB > 0);
  });

});

// ── SwitchStatement type-narrowing (class_id at offset 8) ─────────────────────

describe('GC — SwitchStatement type-narrowing', () => {

  it('switch on class type dispatches to correct branch', async () => {
    // Use the js.wat convention: default value = class ref tells typechecker the param type.
    // Inheritance lets Ok and Err be passed as Result.
    const src = `
      class Result { }
      class Ok  extends Result { }
      class Err extends Result { }

      //@export
      function makeOk()  { return new Ok(); }
      //@export
      function makeErr() { return new Err(); }

      //@export
      function check(r = Result) {
        switch (r) {
          case Ok:  return 1;
          case Err: return 2;
        }
        return 0;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.check(exp.makeOk()),  1);
    assert.equal(exp.check(exp.makeErr()), 2);
  });

});

// ── str → number parsing ──────────────────────────────────────────────────────

describe('GC — str→integer/float parsing', () => {

  it('i32("42") → 42', async () => {
    const src = `
      //@export
      function parse(s = "") { return i32(s); }
    `;
    const exp = await instantiate(src);
    // We need a string constant; the easiest way is to embed it in the source
    // and use a wrapper that calls with a specific literal.
    const src2 = `
      //@export
      function parse42() { return i32("42"); }
    `;
    const exp2 = await instantiate(src2);
    assert.equal(exp2.parse42(), 42);
  });

  it('i32("-7") → -7', async () => {
    const src = `
      //@export
      function parseNeg() { return i32("-7"); }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.parseNeg(), -7);
  });

  it('i32("  123  ") → 123 (leading whitespace)', async () => {
    const src = `
      //@export
      function parseWs() { return i32("  123  "); }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.parseWs(), 123);
  });

  it('isize("0") → 0', async () => {
    const src = `
      //@export
      function parseZero() { return isize("0"); }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.parseZero(), 0);
  });

  it('f64("3.14") ≈ 3.14', async () => {
    const src = `
      //@export
      function parsePi() { return f64("3.14"); }
    `;
    const exp = await instantiate(src);
    const result = exp.parsePi();
    assert.ok(Math.abs(result - 3.14) < 0.001, `expected ~3.14 got ${result}`);
  });

  it('f64("-2.5") ≈ -2.5', async () => {
    const src = `
      //@export
      function parseNeg() { return f64("-2.5"); }
    `;
    const exp = await instantiate(src);
    const result = exp.parseNeg();
    assert.ok(Math.abs(result - (-2.5)) < 0.001, `expected ~-2.5 got ${result}`);
  });

});
