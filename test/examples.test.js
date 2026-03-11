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
  it.skip('21-fizzbuzz.js    — requires std/io, std/string, std/range, for-of');
  it.skip('21-fibonacci.js   — requires classes, Symbol traits, for-of');
  it.skip('21-stack.js       — requires classes, private fields, arrays');
  it.skip('21-result.js      — requires classes, inheritance, switch narrowing');
  it.skip('21-pixel-buffer.js — requires classes, manual memory');
  it.skip('21-wasm-compute.js — requires std/math, std/random, ptr');
  it.skip('21-game-loop.js   — requires classes, static fields, std/math');

});
