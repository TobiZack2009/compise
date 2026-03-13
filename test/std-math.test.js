/**
 * @fileoverview std/math tests.
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

async function instantiate(source) {
  const { wasm } = await compileSource(source);
  const { instance } = await WebAssembly.instantiate(wasm);
  return instance.exports;
}

describe('std/math — native ops', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { Math } from 'std/math';
      //@export
      function sqrtF(x = 0.0) { return Math.sqrt(x); }
      //@export
      function floorF(x = 0.0) { return Math.floor(x); }
      //@export
      function ceilF(x = 0.0) { return Math.ceil(x); }
      //@export
      function absF(x = 0.0) { return Math.abs(x); }
      //@export
      function minF(a = 0.0, b = 0.0) { return Math.min(a, b); }
      //@export
      function maxF(a = 0.0, b = 0.0) { return Math.max(a, b); }
      //@export
      function truncF(x = 0.0) { return Math.trunc(x); }
    `);
  });

  it('Math.sqrt(4.0) → 2.0', () => {
    const r = exp.sqrtF(4.0);
    assert.ok(Math.abs(r - 2.0) < 1e-9, `expected 2.0 got ${r}`);
  });
  it('Math.sqrt(9.0) → 3.0', () => {
    const r = exp.sqrtF(9.0);
    assert.ok(Math.abs(r - 3.0) < 1e-9, `expected 3.0 got ${r}`);
  });
  it('Math.floor(2.7) → 2.0', () => {
    assert.equal(exp.floorF(2.7), 2.0);
  });
  it('Math.floor(-2.3) → -3.0', () => {
    assert.equal(exp.floorF(-2.3), -3.0);
  });
  it('Math.ceil(2.1) → 3.0', () => {
    assert.equal(exp.ceilF(2.1), 3.0);
  });
  it('Math.abs(-5.0) → 5.0', () => {
    assert.equal(exp.absF(-5.0), 5.0);
  });
  it('Math.abs(5.0) → 5.0', () => {
    assert.equal(exp.absF(5.0), 5.0);
  });
  it('Math.min(3.0, 2.0) → 2.0', () => {
    assert.equal(exp.minF(3.0, 2.0), 2.0);
  });
  it('Math.max(3.0, 2.0) → 3.0', () => {
    assert.equal(exp.maxF(3.0, 2.0), 3.0);
  });
  it('Math.trunc(2.9) → 2.0', () => {
    assert.equal(exp.truncF(2.9), 2.0);
  });
  it('Math.trunc(-2.9) → -2.0', () => {
    assert.equal(exp.truncF(-2.9), -2.0);
  });
});

describe('std/math — exponentiation operator **', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { Math } from 'std/math';
      //@export
      function powOp(base = 0.0, e = 0.0) { return base ** e; }
    `);
  });

  it('2.0 ** 0.0 → 1.0', () => {
    const r = exp.powOp(2.0, 0.0);
    assert.ok(Math.abs(r - 1.0) < 1e-6, `expected 1.0 got ${r}`);
  });
  it('2.0 ** 1.0 → 2.0', () => {
    const r = exp.powOp(2.0, 1.0);
    assert.ok(Math.abs(r - 2.0) < 1e-6, `expected 2.0 got ${r}`);
  });
  it('2.0 ** 3.0 → 8.0', () => {
    const r = exp.powOp(2.0, 3.0);
    assert.ok(Math.abs(r - 8.0) < 1e-4, `expected 8.0 got ${r}`);
  });
  it('10.0 ** 2.0 → 100.0', () => {
    const r = exp.powOp(10.0, 2.0);
    assert.ok(Math.abs(r - 100.0) < 0.01, `expected 100.0 got ${r}`);
  });
});

describe('std/math — default import', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import Math from 'std/math';
      //@export
      function sqrtD(x = 0.0) { return Math.sqrt(x); }
      //@export
      function minD(a = 0.0, b = 0.0) { return Math.min(a, b); }
    `);
  });

  it('default import Math.sqrt(16.0) → 4.0', () => {
    const r = exp.sqrtD(16.0);
    assert.ok(Math.abs(r - 4.0) < 1e-9, `expected 4.0 got ${r}`);
  });
  it('default import Math.min(1.0, 2.0) → 1.0', () => {
    assert.equal(exp.minD(1.0, 2.0), 1.0);
  });
});

describe('std/math — transcendental functions', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { Math } from 'std/math';
      //@export
      function expF(x = 0.0) { return Math.exp(x); }
      //@export
      function logF(x = 0.0) { return Math.log(x); }
      //@export
      function sinF(x = 0.0) { return Math.sin(x); }
      //@export
      function cosF(x = 0.0) { return Math.cos(x); }
      //@export
      function powF(base = 0.0, e = 0.0) { return Math.pow(base, e); }
    `);
  });

  it('Math.exp(0.0) ≈ 1.0', () => {
    const r = exp.expF(0.0);
    assert.ok(Math.abs(r - 1.0) < 1e-9, `expected 1.0 got ${r}`);
  });
  it('Math.exp(1.0) ≈ e', () => {
    const r = exp.expF(1.0);
    assert.ok(Math.abs(r - Math.E) < 1e-6, `expected ${Math.E} got ${r}`);
  });
  it('Math.log(1.0) ≈ 0.0', () => {
    const r = exp.logF(1.0);
    assert.ok(Math.abs(r) < 1e-9, `expected 0.0 got ${r}`);
  });
  it('Math.sin(0.0) ≈ 0.0', () => {
    const r = exp.sinF(0.0);
    assert.ok(Math.abs(r) < 1e-9, `expected 0.0 got ${r}`);
  });
  it('Math.cos(0.0) ≈ 1.0', () => {
    const r = exp.cosF(0.0);
    assert.ok(Math.abs(r - 1.0) < 1e-9, `expected 1.0 got ${r}`);
  });
  it('Math.pow(2.0, 3.0) ≈ 8.0', () => {
    const r = exp.powF(2.0, 3.0);
    assert.ok(Math.abs(r - 8.0) < 1e-4, `expected 8.0 got ${r}`);
  });
});
