/**
 * @fileoverview Code generation test suite — WAT structure + WASM roundtrip execution.
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

// ── WAT structure checks ──────────────────────────────────────────────────────

describe('codegen — WAT structure', () => {

  it('emits (module', async () => {
    const { wat } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wat.includes('(module'), `missing (module in:\n${wat}`);
  });

  it('emits (func $add', async () => {
    const { wat } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wat.includes('(func $add'), `missing (func $add in:\n${wat}`);
  });

  it('emits (param $x i32)', async () => {
    const { wat } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wat.includes('(param $x i32)'), `missing (param $x i32) in:\n${wat}`);
  });

  it('emits (result i32)', async () => {
    const { wat } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wat.includes('(result i32)'), `missing (result i32) in:\n${wat}`);
  });

  it('emits memory export', async () => {
    const { wat } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wat.includes('(memory (export "memory") 1)'), `missing memory export in:\n${wat}`);
  });

  it('emits function export', async () => {
    const { wat } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wat.includes('(export "add")'), `missing function export in:\n${wat}`);
  });

  it('emits f64 param for float function', async () => {
    const { wat } = await compileSource('function fadd(a = 0.0, b = 0.0) { return a + b; }');
    assert.ok(wat.includes('(param $a f64)'), `missing f64 param in:\n${wat}`);
    assert.ok(wat.includes('(result f64)'), `missing f64 result in:\n${wat}`);
  });

});

// ── WASM magic bytes ──────────────────────────────────────────────────────────

describe('codegen — WASM binary', () => {

  it('produces valid WASM magic bytes', async () => {
    const { wasm } = await compileSource('function add(x = 0, y = 0) { return x + y; }');
    assert.ok(wasm instanceof Uint8Array, 'wasm should be a Uint8Array');
    assert.equal(wasm[0], 0x00);
    assert.equal(wasm[1], 0x61);
    assert.equal(wasm[2], 0x73);
    assert.equal(wasm[3], 0x6D);
  });

});

// ── WASM execution ────────────────────────────────────────────────────────────

describe('codegen — WASM execution', () => {

  it('add(2, 3) → 5', async () => {
    const { wasm } = await compileSource('function add(a = 0, b = 0) { return a + b; }');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.add(2, 3), 5);
  });

  it('float add(1.5, 2.5) → 4.0', async () => {
    const { wasm } = await compileSource('function add(a = 0.0, b = 0.0) { return a + b; }');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.add(1.5, 2.5), 4.0);
  });

  it('sub(10, 3) → 7', async () => {
    const { wasm } = await compileSource('function sub(a = 0, b = 0) { return a - b; }');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.sub(10, 3), 7);
  });

  it('mul(4, 5) → 20', async () => {
    const { wasm } = await compileSource('function mul(a = 0, b = 0) { return a * b; }');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.mul(4, 5), 20);
  });

  it('id(42) → 42', async () => {
    const { wasm } = await compileSource('function id(x = 0) { return x; }');
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.id(42), 42);
  });

  it('max(a, b) returns the larger value', async () => {
    const src = `
      function max(a = 0, b = 0) {
        if (a > b) { return a; }
        else { return b; }
      }
    `;
    const { wasm } = await compileSource(src);
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.max(3, 7),  7);
    assert.equal(instance.exports.max(9, 2),  9);
    assert.equal(instance.exports.max(5, 5),  5);
  });

  it('double(x) via local variable', async () => {
    const src = `
      function double(x = 0) {
        const y = x + x;
        return y;
      }
    `;
    const { wasm } = await compileSource(src);
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.double(7),  14);
    assert.equal(instance.exports.double(0),  0);
  });

  it('multiple functions in one module', async () => {
    const src = `
      function add(a = 0, b = 0) { return a + b; }
      function mul(a = 0, b = 0) { return a * b; }
    `;
    const { wasm } = await compileSource(src);
    const { instance } = await WebAssembly.instantiate(wasm);
    assert.equal(instance.exports.add(3, 4), 7);
    assert.equal(instance.exports.mul(3, 4), 12);
  });

  it('lerp(0.0, 1.0, 0.5) → 0.5', async () => {
    const src = `function lerp(a = 0.0, b = 0.0, t = 0.0) { return a + (b - a) * t; }`;
    const { wasm } = await compileSource(src);
    const { instance } = await WebAssembly.instantiate(wasm);
    const result = instance.exports.lerp(0.0, 1.0, 0.5);
    assert.ok(Math.abs(result - 0.5) < 1e-9, `expected ~0.5, got ${result}`);
  });

});

// ── Check-only mode ───────────────────────────────────────────────────────────

describe('compiler — check-only mode', () => {

  it('returns null wasm in checkOnly mode', async () => {
    const { wasm, wat } = await compileSource(
      'function add(a = 0, b = 0) { return a + b; }',
      '<test>',
      { checkOnly: true }
    );
    assert.equal(wasm, null);
    assert.equal(wat, '');
  });

  it('throws on invalid source in checkOnly mode', async () => {
    await assert.rejects(
      () => compileSource('function f(x) { return x; }', '<test>', { checkOnly: true }),
      /default/i
    );
  });

});
