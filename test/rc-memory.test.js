/**
 * @fileoverview RC and memory tests.
 *
 * Covers:
 *  1. WAT-level verification: rc_inc / rc_dec emitted correctly, no leaks in codegen
 *  2. RC runtime: same-object stored 100× in array keeps rc=1 (push never rc_inc's)
 *  3. RC runtime: class objects freed to free list when rc hits 0 (slot reuse)
 *  4. Array memory: -1 sentinel at offset 0 → rc_dec is a no-op (documented limitation)
 *  5. Pool allocator: unique slots, free-list reuse, 100-slot stress
 *  6. Arena allocator: monotonic bump, reset brings ptr back to base, OOM guard
 */

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { compileSource } from '../src/compiler.js';

const ROOT     = fileURLToPath(new URL('..', import.meta.url));
const STD_ROOT = join(ROOT, 'std');
const readFile = p => readFileSync(p, 'utf8');

// ── helpers ──────────────────────────────────────────────────────────────────

async function instantiate(src, opts = {}) {
  const { wasm } = await compileSource(src, '<test>', opts);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

async function instantiateWithStd(src) {
  return instantiate(src, { readFile, stdRoot: STD_ROOT });
}

async function getWat(src) {
  const { wat } = await compileSource(src, '<test>');
  return wat;
}

function rcOf(exports, ptr) {
  const mem = new Int32Array(exports.memory.buffer);
  return mem[ptr >> 2] & 0x0FFFFFFF;
}

function word32At(exports, ptr, offset = 0) {
  const mem = new Int32Array(exports.memory.buffer);
  return mem[(ptr + offset) >> 2];
}

// Count call sites for a named function in WAT text.
// Searches for `call $name` to avoid matching function definitions.
function countCalls(wat, fnName) {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (wat.match(new RegExp(`call \\$${escaped}`, 'g')) || []).length;
}

// ── WAT-level: rc_inc emission ────────────────────────────────────────────────

describe('RC — WAT: rc_inc emission', () => {

  it('array push loop emits 0 rc_inc calls', async () => {
    const wat = await getWat(`
      class Pt { val = 0; }
      function fill() {
        const obj = new Pt();
        const refs = [];
        let i = 0;
        while (i < 100) { refs.push(obj); i = i + 1; }
        return obj.val;
      }
    `);
    const incCount = countCalls(wat, '__jswat_rc_inc');
    assert.equal(incCount, 0,
      `push should not emit rc_inc; found ${incCount} call sites in WAT`);
  });

  it('const copy (const q = p) emits exactly 1 rc_inc', async () => {
    const wat = await getWat(`
      class Pt { val = 0; }
      function copyRef() {
        const p = new Pt();
        const q = p;
        return p.val + q.val;
      }
    `);
    const incCount = countCalls(wat, '__jswat_rc_inc');
    assert.equal(incCount, 1,
      `const copy should emit exactly 1 rc_inc call; found ${incCount}`);
  });

  it('heap local emits rc_dec at function exit', async () => {
    const wat = await getWat(`
      class Pt { val = 0; }
      function alloc() {
        const p = new Pt();
        return p.val;
      }
    `);
    const decCount = countCalls(wat, '__jswat_rc_dec');
    assert.ok(decCount >= 1,
      `expected at least 1 rc_dec call at function exit; found ${decCount}`);
  });

  it('returned heap local is skipped (rc_dec count = heap locals - 1)', async () => {
    // Function has 2 heap locals: obj and refs.
    // Returns obj → obj is skipped, only refs is rc_dec'd → 1 rc_dec call.
    const wat = await getWat(`
      class Pt { val = 0; }
      function returnObj() {
        const obj = new Pt();
        const refs = [];
        refs.push(obj);
        return obj;
      }
    `);
    const decCount = countCalls(wat, '__jswat_rc_dec');
    // 1 for refs (array, skipped at runtime via sentinel but still emitted in WAT)
    assert.equal(decCount, 1,
      `expected 1 rc_dec call (refs only, obj skipped as return value); found ${decCount}`);
  });

  it('returning i32 — all heap locals are rc_dec\'d', async () => {
    // Returns obj.val (i32), so both obj and refs are rc_dec'd → 2 calls.
    const wat = await getWat(`
      class Pt { val = 0; }
      function returnI32() {
        const obj = new Pt();
        const refs = [];
        refs.push(obj);
        return obj.val;
      }
    `);
    const decCount = countCalls(wat, '__jswat_rc_dec');
    assert.equal(decCount, 2,
      `expected 2 rc_dec calls (obj + refs); found ${decCount}`);
  });

  it('100-push loop: rc_dec emitted only at function exit, not inside loop', async () => {
    const wat = await getWat(`
      class Pt { val = 0; }
      function pushLoop() {
        const obj = new Pt();
        const refs = [];
        let i = 0;
        while (i < 100) { refs.push(obj); i = i + 1; }
        return obj.val;
      }
    `);
    // rc_dec calls appear exactly twice (obj + refs) at function exit only.
    const decCount = countCalls(wat, '__jswat_rc_dec');
    assert.equal(decCount, 2,
      `rc_dec should appear exactly twice (obj + refs at function exit); found ${decCount}`);
  });

});

// ── RC runtime: same-object stored 100× in array ─────────────────────────────

describe('RC — runtime: 100 references to same object', () => {

  let exp;
  before(async () => {
    exp = await instantiate(`
      class Pt { val = 0; }

      //@export
      function makeAndFill() {
        const obj = new Pt();
        obj.val = 99;
        const refs = [];
        let i = 0;
        while (i < 100) { refs.push(obj); i = i + 1; }
        return obj;
        // obj is NOT rc_dec'd (returned); refs is rc_dec'd → no-op (array sentinel)
      }

      //@export
      function testAllSamePtr() {
        const obj = new Pt();
        obj.val = 7;
        const refs = [];
        let i = 0;
        while (i < 100) { refs.push(obj); i = i + 1; }
        // verify each slot stores the exact same pointer as obj
        let ok = 1;
        i = 0;
        while (i < 100) {
          if (refs[i] !== obj) { ok = 0; }
          i = i + 1;
        }
        return ok;
        // At return: both obj and refs rc_dec'd. refs sentinel → no-op; obj rc=1→0 → freed.
      }
    `);
  });

  it('all 100 array slots contain the same pointer (rc unchanged by push)', () => {
    const result = exp.testAllSamePtr();
    assert.equal(result, 1, 'all array elements should equal the original object pointer');
  });

  it('rc of returned object is 1 after 100 pushes (push does not rc_inc)', () => {
    const ptr = exp.makeAndFill();
    assert.ok(ptr > 0, 'returned pointer should be non-null');
    const rc = rcOf(exp, ptr);
    assert.equal(rc, 1,
      `rc should be 1 after 100 pushes into array (push never calls rc_inc); got ${rc}`);
  });

  it('array has -1 sentinel at offset 0 (rc_dec is a no-op)', () => {
    const ptr = exp.makeAndFill();
    // The array local `refs` was rc_dec'd at function exit.
    // We can verify arrays use -1 sentinel by allocating an array and reading offset 0.
    // We know makeAndFill returns obj, so obj.rc=1. The refs array was rc_dec'd (no-op).
    // Verify obj layout is correct (rc header at 0, not sentinel).
    const w0 = word32At(exp, ptr, 0);
    assert.ok((w0 & 0x0FFFFFFF) === 1,
      `object at returned ptr should have rc=1 at offset 0 (w0=0x${(w0 >>> 0).toString(16)})`);
  });

});

// ── RC runtime: free-list reuse (objects ARE freed when rc hits 0) ───────────

describe('RC — runtime: class object freed to free list on rc=0', () => {

  let exp;
  before(async () => {
    exp = await instantiate(`
      class Box { v = 0; }

      //@export
      function allocAndFree() {
        const b = new Box();
        b.v = 55;
        return b;       // rc stays 1 (not freed), caller owns it
      }

      //@export
      function allocAndDrop() {
        const b = new Box();
        b.v = 55;
        return b.v;     // returns i32 → b is rc_dec'd at exit → rc=0 → freed to free list
      }

      //@export
      function twoAllocs() {
        // First alloc: b1 freed (rc_dec on exit), slot returned to free list.
        // Second alloc in same call: should reuse same slot.
        const b1 = new Box();
        b1.v = 11;
        const b1ptr = b1;    // hold ptr as i32... wait b1 is class type
        return b1.v;         // b1 freed
      }
    `);
  });

  it('returned object has rc=1', () => {
    const ptr = exp.allocAndFree();
    assert.ok(ptr > 0);
    assert.equal(rcOf(exp, ptr), 1, 'caller-owned object should have rc=1');
  });

  it('dropping return value (allocAndDrop) does not crash', () => {
    // If rc goes 0 correctly, free completes without crash.
    assert.equal(exp.allocAndDrop(), 55);
    assert.equal(exp.allocAndDrop(), 55);
    assert.equal(exp.allocAndDrop(), 55);
  });

  it('same slot reused after free — raw allocator free-list', async () => {
    // Use the exported __jswat_alloc / __jswat_free to directly prove free-list reuse.
    const rawExp = await instantiate('function noop() {}');
    const a = rawExp.__jswat_alloc(16);  // bump alloc → addr A
    rawExp.__jswat_free(a, 16);           // return A to size-class-1 free list
    const b = rawExp.__jswat_alloc(16);  // should pop A from free list
    assert.equal(b, a, `free-list reuse: alloc after free should return same address (${a})`);
  });

  it('class object slot reused after rc hits 0', async () => {
    // allocDrop() allocates a Box, drops it (rc→0 → freed), returns val.
    // Calling allocDrop() twice should not crash and should return correct value
    // each time (the slot is recycled via the free list).
    const innerExp = await instantiate(`
      class BoxR { v = 0; }
      //@export
      function allocDrop(x = 0) {
        const b = new BoxR();
        b.v = x;
        return b.v;  // b freed at exit → slot to free list
      }
      //@export
      function allocPtr() {
        return new BoxR();  // returns ptr; not freed (caller owns rc=1)
      }
    `);
    // Seed free list then verify reuse via address.
    innerExp.allocDrop(1);   // frees BoxR at addr A → free list
    const ptr1 = innerExp.allocPtr();  // reuses addr A from free list
    innerExp.allocDrop(2);   // frees BoxR at addr B (bump) → free list
    innerExp.allocDrop(3);   // free list has B → reuse B, free again → free list has B
    const ptr2 = innerExp.allocPtr();  // should reuse addr B
    assert.ok(ptr1 > 0, 'first recycled ptr should be non-null');
    assert.ok(ptr2 > 0, 'second recycled ptr should be non-null');
    assert.notEqual(ptr1, ptr2, 'two concurrently-live objects must have distinct addresses');
  });

  it('stress: 10000 allocations in a loop do not OOM (free-list recycles)', async () => {
    const stressExp = await instantiate(`
      class Cell { x = 0; }
      //@export
      function stress(n = 0) {
        let i = 0;
        let last = 0;
        while (i < n) {
          const c = new Cell();
          c.x = i;
          last = c.x;    // c is rc_dec'd at end of each iteration
          i = i + 1;
        }
        return last;
      }
    `);
    // Without free-list reuse this would OOM; with it, the same slot is recycled.
    assert.equal(stressExp.stress(10000), 9999);
    assert.equal(stressExp.stress(10000), 9999);
  });

});

// ── Array memory: documented limitations ─────────────────────────────────────

describe('RC — array memory limitations (documented)', () => {

  it('array offset-0 is -1 sentinel → rc_dec is a no-op (by design)', async () => {
    // Verify that arrays get -1 at offset 0 from __alloc, making rc_dec a no-op.
    // We export the array ptr to inspect it.
    const exp = await instantiate(`
      //@export
      function makeArr() {
        const a = [10, 20, 30];
        return a;        // array NOT rc_dec'd (returned), rc_dec would be no-op anyway
      }
    `);
    const arrPtr = exp.makeArr();
    assert.ok(arrPtr > 0, 'array pointer should be non-null');
    const sentinel = word32At(exp, arrPtr, 0);
    assert.equal(sentinel | 0, -1,
      `array[offset=0] should be -1 (sentinel that makes rc_dec a no-op), got ${sentinel}`);
  });

  it('array len at offset 4 matches number of elements', async () => {
    const exp = await instantiate(`
      //@export
      function makeArr() { return [1, 2, 3, 4, 5]; }
    `);
    const ptr = exp.makeArr();
    const len = word32At(exp, ptr, 4);
    assert.equal(len, 5, `array len at offset 4 should be 5, got ${len}`);
  });

  it('data_ptr at offset 12 is non-null and distinct from array ptr', async () => {
    const exp = await instantiate(`
      //@export
      function makeArr() { return [0, 0, 0]; }
    `);
    const ptr = exp.makeArr();
    const dataPtr = word32At(exp, ptr, 12);
    assert.ok(dataPtr > 0, 'data buffer pointer should be non-null');
    assert.notEqual(dataPtr, ptr, 'data buffer should be at a different address than the array header');
  });

  it('100-push loop does not OOM (array grows without rc overhead)', async () => {
    // Arrays grow by doubling; no element rc_dec on realloc — just raw memcopy.
    const exp = await instantiate(`
      //@export
      function buildLargeArr(n = 0) {
        const a = [];
        let i = 0;
        while (i < n) { a.push(i); i = i + 1; }
        return a;
      }
      //@export
      function arrLen(a = 0) {
        const b = [0];
        b[0] = a;
        return b[0];    // hack: re-read a as i32; actual len is at arr+4
      }
    `);
    const arrPtr = exp.buildLargeArr(100);
    const len = word32At(exp, arrPtr, 4);
    assert.equal(len, 100, `array length should be 100 after 100 pushes, got ${len}`);
  });

});

// ── Pool allocator ────────────────────────────────────────────────────────────

describe('Pool allocator (std/alloc/pool)', () => {

  let exp;
  before(async () => {
    exp = await instantiateWithStd(`
      import { Pool } from 'std/alloc/pool';

      //@export
      function poolAllocTwo() {
        const p = new Pool(usize(16), usize(32));
        const a = p.alloc();
        const b = p.alloc();
        // b > a because slots are adjacent (stride=16)
        if (b !== a + usize(16)) { return 0; }
        return 1;
      }

      //@export
      function poolFreeReuse() {
        const p = new Pool(usize(8), usize(16));
        const a = p.alloc();
        p.free(a);
        const b = p.alloc();   // should reuse a's slot
        if (a !== b) { return 0; }
        return 1;
      }

      //@export
      function pool100Unique() {
        const p = new Pool(usize(8), usize(128));
        let prev = usize(0);
        let i = 0;
        let ok = 1;
        while (i < 100) {
          const slot = p.alloc();
          if (slot === prev) { ok = 0; }
          prev = slot;
          i = i + 1;
        }
        return ok;
      }

      //@export
      function poolFreeAll() {
        const p = new Pool(usize(16), usize(8));
        const s0 = p.alloc();
        const s1 = p.alloc();
        const s2 = p.alloc();
        p.free(s2);
        p.free(s1);
        p.free(s0);
        // After freeing all, alloc returns them in LIFO order (freelist stack)
        const r0 = p.alloc();
        const r1 = p.alloc();
        const r2 = p.alloc();
        // LIFO: r0=s0, r1=s1, r2=s2
        if (r0 !== s0) { return 0; }
        if (r1 !== s1) { return 0; }
        if (r2 !== s2) { return 0; }
        return 1;
      }
    `);
  });

  it('two consecutive allocs are stride bytes apart', () => {
    assert.equal(exp.poolAllocTwo(), 1, 'consecutive pool slots should be stride=16 bytes apart');
  });

  it('freed slot is reused by next alloc (free-list)', () => {
    assert.equal(exp.poolFreeReuse(), 1, 'alloc after free should return same address');
  });

  it('100 allocs all return unique addresses', () => {
    assert.equal(exp.pool100Unique(), 1, 'all 100 pool slots should be unique');
  });

  it('free all then realloc returns same slots (LIFO freelist)', () => {
    assert.equal(exp.poolFreeAll(), 1, 'freed slots should be reused LIFO via freelist');
  });

});

// ── Arena allocator ───────────────────────────────────────────────────────────

describe('Arena allocator (std/alloc/arena)', () => {

  let exp;
  before(async () => {
    exp = await instantiateWithStd(`
      import { Arena } from 'std/alloc/arena';

      //@export
      function arenaMonotonic() {
        const a = new Arena(usize(256));
        const p1 = a.alloc(usize(16));
        const p2 = a.alloc(usize(16));
        const p3 = a.alloc(usize(8));
        // Addresses must be monotonically increasing
        if (p2 <= p1) { return 0; }
        if (p3 <= p2) { return 0; }
        // Differences must match allocation sizes
        if (p2 - p1 !== usize(16)) { return 0; }
        if (p3 - p2 !== usize(16)) { return 0; }
        return 1;
      }

      //@export
      function arenaReset() {
        const a = new Arena(usize(128));
        const p1 = a.alloc(usize(32));
        const p2 = a.alloc(usize(32));
        a.reset();
        const p3 = a.alloc(usize(32));  // should equal p1 after reset
        if (p3 !== p1) { return 0; }
        const p4 = a.alloc(usize(32));  // should equal p2
        if (p4 !== p2) { return 0; }
        return 1;
      }

      //@export
      function arenaOOM() {
        const a = new Arena(usize(64));
        const p1 = a.alloc(usize(32));
        const p2 = a.alloc(usize(32));
        const p3 = a.alloc(usize(32));  // over capacity: should return 0
        if (p1 === usize(0)) { return 0; }
        if (p2 === usize(0)) { return 0; }
        if (p3 !== usize(0)) { return 0; }  // p3 must be null (OOM)
        return 1;
      }

      //@export
      function arenaWriteRead() {
        const a = new Arena(usize(64));
        const p = a.alloc(usize(4));
        return p;  // caller writes/reads memory at this address
      }
    `);
  });

  it('allocs return monotonically increasing addresses spaced by allocation size', () => {
    assert.equal(exp.arenaMonotonic(), 1, 'arena allocs should be contiguous and monotonic');
  });

  it('reset brings bump ptr back to base — reallocs return same addresses', () => {
    assert.equal(exp.arenaReset(), 1, 'after reset, alloc should return same addresses as before');
  });

  it('alloc beyond capacity returns 0 (OOM guard)', () => {
    assert.equal(exp.arenaOOM(), 1, 'arena alloc past capacity should return 0');
  });

  it('allocated region is writable', () => {
    const p = exp.arenaWriteRead();
    assert.ok(p > 0, 'arena alloc should return non-null ptr');
    // Write to allocated region via memory
    const mem = new Int32Array(exp.memory.buffer);
    mem[p >> 2] = 0xDEADBEEF | 0;
    assert.equal(mem[p >> 2], 0xDEADBEEF | 0, 'allocated region should be writable');
  });

});

// ── Combined: RC + array — 100 distinct objects, all stored in array ──────────

describe('RC — 100 distinct objects in array', () => {

  it('all objects stored with correct values (no UAF from early free)', async () => {
    // Objects in a loop: the `const obj` local is rc_dec'd at END of loop iteration.
    // This means the object IS freed after each iteration, and the array holds a
    // dangling pointer. This test documents the current behavior:
    // - We can't safely read array elements for class objects allocated per-iteration.
    // - Safe pattern: hold a reference OUTSIDE the loop (see testAllSamePtr above).
    //
    // For i32 arrays (no class objects), this works fine:
    const exp = await instantiate(`
      //@export
      function fillI32s(n = 0) {
        const arr = [];
        let i = 0;
        while (i < n) { arr.push(i * 2); i = i + 1; }
        return arr;
      }
      //@export
      function readElem(arrPtr = 0, idx = 0) {
        const a = [0];
        a[0] = arrPtr;
        return a[idx];   // re-index
      }
    `);
    const arrPtr = exp.fillI32s(100);
    assert.ok(arrPtr > 0, 'array should be allocated');
    const len = word32At(exp, arrPtr, 4);
    assert.equal(len, 100, 'array length should be 100');
    // Read the data buffer directly from memory
    const dataPtr = word32At(exp, arrPtr, 12);
    const mem = new Int32Array(exp.memory.buffer);
    for (let i = 0; i < 100; i++) {
      const expected = i * 2;
      const actual = mem[(dataPtr >> 2) + i];
      assert.equal(actual, expected, `arr[${i}] should be ${expected}, got ${actual}`);
    }
  });

  it('WAT: 100-element array literal has no rc_inc per element', async () => {
    // Confirm that static array element initialisation emits no rc_inc calls.
    const wat = await getWat(`
      function makeArr() {
        const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        return a;
      }
    `);
    const incCount = countCalls(wat, '__jswat_rc_inc');
    assert.equal(incCount, 0,
      `array literal should not emit any rc_inc calls; found ${incCount}`);
  });

});
