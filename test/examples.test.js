/**
 * @fileoverview Integration tests for the Phase 1 example files in examples/.
 * Compiles each example and verifies correct WASM execution.
 */

import { strict as assert } from 'assert';
import { readFile } from 'fs/promises';
import { compileSource } from '../src/compiler.js';

/**
 * Compile a source file and return the instantiated WASM exports.
 * @param {string} path  path relative to project root
 * @returns {Promise<WebAssembly.Exports>}
 */
async function instantiateFile(path, importObject = undefined) {
  const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  const { wasm } = await compileSource(source, path);
  const { instance } = await WebAssembly.instantiate(wasm, importObject);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

/**
 * Compile a source string and return the instantiated WASM exports.
 * @param {string} source
 * @returns {Promise<WebAssembly.Exports>}
 */
async function instantiate(source) {
  const { wasm } = await compileSource(source);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

// ── examples/add.js ──────────────────────────────────────────────────────────

describe('examples/add.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/add.js'); });

  it('add(0, 0) → 0',   () => assert.equal(exp.add(0, 0), 0));
  it('add(2, 3) → 5',   () => assert.equal(exp.add(2, 3), 5));
  it('add(-1, 1) → 0',  () => assert.equal(exp.add(-1, 1), 0));
  it('add(100, 200) → 300', () => assert.equal(exp.add(100, 200), 300));
});

// ── examples/lerp.js ─────────────────────────────────────────────────────────

describe('examples/lerp.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/lerp.js'); });

  it('lerp(0.0, 1.0, 0.0) → 0.0', () => assert.equal(exp.lerp(0.0, 1.0, 0.0), 0.0));
  it('lerp(0.0, 1.0, 1.0) → 1.0', () => assert.equal(exp.lerp(0.0, 1.0, 1.0), 1.0));
  it('lerp(0.0, 1.0, 0.5) ≈ 0.5', () => {
    const r = exp.lerp(0.0, 1.0, 0.5);
    assert.ok(Math.abs(r - 0.5) < 1e-9, `expected ~0.5 got ${r}`);
  });
  it('lerp(2.0, 4.0, 0.5) ≈ 3.0', () => {
    const r = exp.lerp(2.0, 4.0, 0.5);
    assert.ok(Math.abs(r - 3.0) < 1e-9, `expected ~3.0 got ${r}`);
  });
  it('lerp(10.0, 20.0, 0.25) ≈ 12.5', () => {
    const r = exp.lerp(10.0, 20.0, 0.25);
    assert.ok(Math.abs(r - 12.5) < 1e-9, `expected ~12.5 got ${r}`);
  });
});

// ── examples/math.js ─────────────────────────────────────────────────────────

describe('examples/math.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/math.js'); });

  it('add(3, 4) → 7',       () => assert.equal(exp.add(3, 4), 7));
  it('sub(10, 3) → 7',      () => assert.equal(exp.sub(10, 3), 7));
  it('mul(6, 7) → 42',      () => assert.equal(exp.mul(6, 7), 42));
  it('div(20, 4) → 5',      () => assert.equal(exp.div(20, 4), 5));
  it('mod(17, 5) → 2',      () => assert.equal(exp.mod(17, 5), 2));

  it('max(3, 7) → 7',       () => assert.equal(exp.max(3, 7), 7));
  it('max(9, 2) → 9',       () => assert.equal(exp.max(9, 2), 9));
  it('max(5, 5) → 5',       () => assert.equal(exp.max(5, 5), 5));

  it('min(3, 7) → 3',       () => assert.equal(exp.min(3, 7), 3));
  it('min(9, 2) → 2',       () => assert.equal(exp.min(9, 2), 2));

  it('abs(5) → 5',          () => assert.equal(exp.abs(5), 5));
  it('abs(-5) → 5',         () => assert.equal(exp.abs(-5), 5));
  it('abs(0) → 0',          () => assert.equal(exp.abs(0), 0));

  it('clamp(5, 0, 10) → 5', () => assert.equal(exp.clamp(5, 0, 10), 5));
  it('clamp(-1, 0, 10) → 0',() => assert.equal(exp.clamp(-1, 0, 10), 0));
  it('clamp(11, 0, 10) → 10',()=> assert.equal(exp.clamp(11, 0, 10), 10));
});

// ── examples/floats.js ───────────────────────────────────────────────────────

describe('examples/floats.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/floats.js'); });

  it('fadd(1.5, 2.5) → 4.0', () => assert.equal(exp.fadd(1.5, 2.5), 4.0));
  it('fsub(5.0, 3.0) → 2.0', () => assert.equal(exp.fsub(5.0, 3.0), 2.0));
  it('fmul(2.0, 3.0) → 6.0', () => assert.equal(exp.fmul(2.0, 3.0), 6.0));
  it('fdiv(10.0, 4.0) → 2.5',() => assert.equal(exp.fdiv(10.0, 4.0), 2.5));

  it('fmax(3.0, 7.0) → 7.0', () => assert.equal(exp.fmax(3.0, 7.0), 7.0));
  it('fmax(9.0, 2.0) → 9.0', () => assert.equal(exp.fmax(9.0, 2.0), 9.0));
  it('fmin(3.0, 7.0) → 3.0', () => assert.equal(exp.fmin(3.0, 7.0), 3.0));

  it('lerp(0.0, 10.0, 0.3) ≈ 3.0', () => {
    const r = exp.lerp(0.0, 10.0, 0.3);
    assert.ok(Math.abs(r - 3.0) < 1e-9, `expected ~3.0 got ${r}`);
  });

  it('saturate(-0.5) → 0.0', () => assert.equal(exp.saturate(-0.5), 0.0));
  it('saturate(0.5) → 0.5',  () => {
    const r = exp.saturate(0.5);
    assert.ok(Math.abs(r - 0.5) < 1e-9, `expected 0.5 got ${r}`);
  });
  it('saturate(1.5) → 1.0',  () => assert.equal(exp.saturate(1.5), 1.0));
});

// ── examples/loops.js ────────────────────────────────────────────────────────

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

// ── examples/fibonacci.js ─────────────────────────────────────────────────────

describe('examples/fibonacci.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/fibonacci.js'); });

  it('fib(0) → 0', () => assert.equal(exp.fib(0), 0));
  it('fib(1) → 1', () => assert.equal(exp.fib(1), 1));
  it('fib(6) → 8', () => assert.equal(exp.fib(6), 8));
});

// ── examples/class.js ─────────────────────────────────────────────────────────

describe('examples/class.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/class.js'); });

  it('main(3, 4) → 10', () => assert.equal(exp.main(3, 4), 10));
});

// ── examples/casts.js ────────────────────────────────────────────────────────

describe('examples/casts.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/casts.js'); });

  it('toU8(255) → 255',         () => assert.equal(exp.toU8(255), 255));
  it('toU8(256) → 0 (wrap)',    () => assert.equal(exp.toU8(256), 0));
  it('toU8(257) → 1 (wrap)',    () => assert.equal(exp.toU8(257), 1));

  it('toU16(65535) → 65535',    () => assert.equal(exp.toU16(65535), 65535));
  it('toU16(65536) → 0 (wrap)', () => assert.equal(exp.toU16(65536), 0));

  it('toF64(42) → 42.0',        () => assert.equal(exp.toF64(42), 42.0));
  it('truncI32(3.7) → 3',       () => assert.equal(exp.truncI32(3.7), 3));
  it('truncI32(-3.7) → -3',     () => assert.equal(exp.truncI32(-3.7), -3));
});

// ── --emit-wat CLI option ─────────────────────────────────────────────────────

describe('--emit-wat / WAT output', () => {

  it('compileSource returns non-empty wat string', async () => {
    const source = 'function add(a = 0, b = 0) { return a + b; }';
    const { wat } = await compileSource(source);
    assert.ok(typeof wat === 'string' && wat.length > 0, 'expected non-empty wat');
    assert.ok(wat.startsWith('(module'), `WAT should start with (module, got: ${wat.slice(0,40)}`);
  });

  it('WAT for math.js contains all exported function names', async () => {
    const source = await readFile(new URL('../examples/math.js', import.meta.url), 'utf8');
    const { wat } = await compileSource(source, 'math.js');
    for (const fn of ['add', 'sub', 'mul', 'div', 'mod', 'max', 'min', 'abs', 'clamp']) {
      assert.ok(wat.includes(`$${fn}`), `missing $${fn} in WAT`);
    }
  });

  it('WAT for clamp contains nested if blocks', async () => {
    const source = await readFile(new URL('../examples/math.js', import.meta.url), 'utf8');
    const { wat } = await compileSource(source, 'math.js');
    // clamp has a nested else-if, which means multiple `if` blocks
    const ifCount = (wat.match(/\bif\b/g) ?? []).length;
    assert.ok(ifCount >= 2, `expected at least 2 'if' blocks in WAT, got ${ifCount}`);
  });

  it('WAT for floats.js uses f64 instructions', async () => {
    const source = await readFile(new URL('../examples/floats.js', import.meta.url), 'utf8');
    const { wat } = await compileSource(source, 'floats.js');
    assert.ok(wat.includes('f64.add'), `missing f64.add in:\n${wat}`);
    assert.ok(wat.includes('f64.lt'),  `missing f64.lt in:\n${wat}`);
  });

});

// ── Section 21 examples — Phase 2 pending ────────────────────────────────────
// These examples use classes, imports, and std library features not yet
// implemented. They are skipped here and will be enabled in Phase 2.

describe('section 21 examples (Phase 2+)', () => {

  it('21-hello-world.js — requires std/io', async () => {
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write: () => 0,
        fd_read: () => 0,
      },
    };
    const exp = await instantiateFile('examples/21-hello-world.js', importObject);
    assert.ok(exp, 'expected WASM exports');
  });
  it('21-fizzbuzz.js — std/io, std/string, std/range, for-of', async () => {
    let output = '';
    const source = await readFile(new URL('../examples/21-fizzbuzz.js', import.meta.url), 'utf8');
    const { wasm } = await compileSource(source, '21-fizzbuzz.js');
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write(_fd, iovs_ptr, iovs_len, nwritten_ptr) {
          const mem = new Uint8Array(instance.exports.memory.buffer);
          const view = new DataView(instance.exports.memory.buffer);
          for (let i = 0; i < iovs_len; i++) {
            const base = iovs_ptr + i * 8;
            const ptr  = view.getUint32(base, true);
            const len  = view.getUint32(base + 4, true);
            output += new TextDecoder().decode(mem.slice(ptr, ptr + len));
          }
          view.setUint32(nwritten_ptr, 1, true);
          return 0;
        },
        fd_read: () => 0,
        proc_exit: () => {},
      },
    };
    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    if (instance.exports.__start) instance.exports.__start();
    assert.ok(output.includes('Fizz'),     'expected Fizz in output');
    assert.ok(output.includes('Buzz'),     'expected Buzz in output');
    assert.ok(output.includes('FizzBuzz'), 'expected FizzBuzz in output');
    // Spot-check: 15 is FizzBuzz, 3 is Fizz, 5 is Buzz
    assert.ok(!output.includes('15'),      '15 should be FizzBuzz, not a number');
  });
  it('21-fibonacci.js — FibIterator class, IteratorResult built-in, for-of', async () => {
    let output = '';
    const source = await readFile(new URL('../examples/21-fibonacci.js', import.meta.url), 'utf8');
    const { wasm } = await compileSource(source, '21-fibonacci.js');
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write(_fd, iovs_ptr, iovs_len, nwritten_ptr) {
          const mem = new Uint8Array(instance.exports.memory.buffer);
          const view = new DataView(instance.exports.memory.buffer);
          for (let i = 0; i < iovs_len; i++) {
            const base = iovs_ptr + i * 8;
            const ptr  = view.getUint32(base, true);
            const len  = view.getUint32(base + 4, true);
            output += new TextDecoder().decode(mem.slice(ptr, ptr + len));
          }
          view.setUint32(nwritten_ptr, 1, true);
          return 0;
        },
        fd_read: () => 0,
        proc_exit: () => {},
      },
    };
    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    if (instance.exports.__start) instance.exports.__start();
    const nums = output.trim().split('\n').map(Number);
    assert.deepEqual(nums, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34], `Fibonacci sequence: ${output}`);
  });
  it('21-stack.js — Stack class, private fields, arrays (push/pop/bracket access)', async () => {
    const source = await readFile(new URL('../examples/21-stack.js', import.meta.url), 'utf8');
    const { wasm } = await compileSource(source, '21-stack.js');
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write: () => 0, fd_read: () => 0, proc_exit: () => {},
      },
    };
    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    // Just verify it runs without throwing
    instance.exports.__start();
  });
  it('21-result.js — Result/Ok/Err classes, inheritance, switch type narrowing, template literals', async () => {
    let output = '';
    const source = await readFile(new URL('../examples/21-result.js', import.meta.url), 'utf8');
    const { wasm } = await compileSource(source, '21-result.js');
    let instance;
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
          const mem = new Uint8Array(instance.exports.memory.buffer);
          const view = new DataView(instance.exports.memory.buffer);
          for (let i = 0; i < iovs_len; i++) {
            const base = iovs_ptr + i * 8;
            const ptr = view.getUint32(base, true);
            const len = view.getUint32(base + 4, true);
            output += new TextDecoder().decode(mem.slice(ptr, ptr + len));
          }
          view.setUint32(nwritten_ptr, 1, true);
          return 0;
        },
        fd_read: () => 0,
        proc_exit: () => {},
      },
    };
    const result = await WebAssembly.instantiate(wasm, importObject);
    instance = result.instance;
    instance.exports.__start();
    const lines = output.trim().split('\n');
    assert.equal(lines[0], 'Result: 5',           `Expected 'Result: 5', got: ${lines[0]}`);
    assert.equal(lines[1], 'Error: division by zero', `Expected 'Error: division by zero', got: ${lines[1]}`);
  });
  it.skip('21-pixel-buffer.js — requires classes, manual memory');
  it('21-wasm-compute.js — ptr type, dot_product, matrix_fill_random', async () => {
    const source = await readFile(new URL('../examples/21-wasm-compute.js', import.meta.url), 'utf8');
    const { wasm } = await compileSource(source, '21-wasm-compute.js');
    let instance;
    const importObject = {
      wasi_snapshot_preview1: {
        random_get(bufPtr, bufLen) {
          const mem = new Uint8Array(instance.exports.memory.buffer);
          for (let i = 0; i < bufLen; i++) mem[bufPtr + i] = (i * 37 + 13) & 0xff;
          return 0;
        },
        proc_exit: () => {},
      },
    };
    ({ instance } = await WebAssembly.instantiate(wasm, importObject));
    const view = new DataView(instance.exports.memory.buffer);
    // Allocate 3-element f64 vectors
    const aPtr = instance.exports.__alloc(24, 0);
    const bPtr = instance.exports.__alloc(24, 0);
    view.setFloat64(aPtr,      1.0, true);
    view.setFloat64(aPtr +  8, 2.0, true);
    view.setFloat64(aPtr + 16, 3.0, true);
    view.setFloat64(bPtr,      4.0, true);
    view.setFloat64(bPtr +  8, 5.0, true);
    view.setFloat64(bPtr + 16, 6.0, true);
    // dot([1,2,3],[4,5,6]) = 32
    const dp = instance.exports.dot_product(aPtr, bPtr, 3);
    assert.equal(dp, 32, `dot_product should be 32, got ${dp}`);
    // matrix_fill_random should not crash and fill memory
    instance.exports.seed(42);
    const matPtr = instance.exports.__alloc(9 * 8, 0);
    instance.exports.matrix_fill_random(matPtr, 3, 3);
    // at least one element should be a finite number
    const v = view.getFloat64(matPtr, true);
    assert.ok(Number.isFinite(v), `matrix element should be finite, got ${v}`);
  });
  it('21-game-loop.js — classes, static fields/methods/getters, inheritance, std/math', async () => {
    let output = '';
    const source = await readFile(new URL('../examples/21-game-loop.js', import.meta.url), 'utf8');
    const { wasm } = await compileSource(source, '21-game-loop.js');
    const importObject = {
      wasi_snapshot_preview1: {
        fd_write(_fd, iovs_ptr, iovs_len, nwritten_ptr) {
          const mem = new Uint8Array(instance.exports.memory.buffer);
          const view = new DataView(instance.exports.memory.buffer);
          for (let i = 0; i < iovs_len; i++) {
            const base = iovs_ptr + i * 8;
            const ptr  = view.getUint32(base, true);
            const len  = view.getUint32(base + 4, true);
            output += new TextDecoder().decode(mem.slice(ptr, ptr + len));
          }
          view.setUint32(nwritten_ptr, 1, true);
          return 0;
        },
        fd_read: () => 0,
        proc_exit: () => {},
      },
    };
    const { instance } = await WebAssembly.instantiate(wasm, importObject);
    if (instance.exports.__start) instance.exports.__start();
    const exp = instance.exports;
    exp.game_init();
    assert.equal(exp.game_running(), 1, 'running after init');
    exp.game_move(1.0, 0.0);
    exp.game_update(0.5);
    exp.game_damage(50);
    assert.equal(exp.game_running(), 1, 'running after 50 damage (50 hp left)');
    exp.game_damage(60);
    assert.equal(exp.game_running(), 0, 'stopped after 60 more damage (0 hp)');
    assert.ok(output.includes('Game over'), `expected "Game over" in output, got: ${JSON.stringify(output)}`);
  });

});
