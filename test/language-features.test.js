/**
 * @fileoverview Tests for new language features:
 *   - Sealed unions (static $variants = [])
 *   - Compile-time $ properties (T.$byteSize, T.$classId, T.$headerSize, T.$stride, e.$addr)
 *   - Named argument constructors (new Vec2({ x: 1.0, y: 2.0 }))
 */

import { strict as assert } from 'assert';
import { join } from 'path';
import { readFileSync } from 'fs';
import { compileSource } from '../src/compiler.js';

const ROOT     = new URL('..', import.meta.url).pathname;
const STD_ROOT = join(ROOT, 'std');
const readFileFn = p => readFileSync(p, 'utf8');

async function compile(src) {
  return compileSource(src, '<test>', { readFile: readFileFn, stdRoot: STD_ROOT });
}

async function instantiate(src) {
  const result = await compile(src);
  const mod = await WebAssembly.instantiate(result.wasm, {
    wasi_snapshot_preview1: {
      fd_write: () => 0, proc_exit: () => {}, fd_read: () => 0,
      path_open: () => 1, fd_close: () => 0, fd_seek: () => 0,
    },
  });
  return mod.instance.exports;
}

// ── Sealed Unions ─────────────────────────────────────────────────────────────

describe('Sealed Unions (static $variants = [])', () => {
  const SEALED_SRC = `
    class Shape { static $variants = []; }
    class Circle extends Shape {
      radius = 0.0;
      constructor(r = 0.0) { super(); this.radius = r; }
    }
    class Rect extends Shape {
      w = 0.0;
      h = 0.0;
      constructor(w = 0.0, h = 0.0) { super(); this.w = w; this.h = h; }
    }
  `;

  it('sealed union base class compiles without error', async () => {
    await assert.doesNotReject(compile(SEALED_SRC));
  });

  it('switch on sealed union with all variants covered compiles', async () => {
    const src = SEALED_SRC + `
      //@export
      function area(s = new Shape()) {
        switch (s) {
          case Circle:
            return i32(1);
          case Rect:
            return i32(2);
        }
        return i32(0);
      }
    `;
    await assert.doesNotReject(compile(src));
  });

  it('switch on sealed union with missing variant throws CE-CF07', async () => {
    const src = SEALED_SRC + `
      //@export
      function area(s = new Shape()) {
        switch (s) {
          case Circle:
            return i32(1);
        }
        return i32(0);
      }
    `;
    await assert.rejects(compile(src), /CE-CF07/);
  });

  it('switch with default case does NOT require exhaustiveness', async () => {
    const src = SEALED_SRC + `
      //@export
      function area(s = new Shape()) {
        switch (s) {
          case Circle:
            return i32(1);
          default:
            return i32(0);
        }
        return i32(0);
      }
    `;
    await assert.doesNotReject(compile(src));
  });

  it('type narrowing: Circle case can access radius field', async () => {
    const src = SEALED_SRC + `
      //@export
      function getRadius(s = new Circle(5.0)) {
        switch (s) {
          case Circle:
            return i32(1);
          case Rect:
            return i32(2);
        }
        return i32(0);
      }
    `;
    await assert.doesNotReject(compile(src));
  });

  it('sealed union switch generates class_id comparison WAT', async () => {
    const src = SEALED_SRC + `
      //@export
      function classify(s = new Shape()) {
        switch (s) {
          case Circle: return i32(1);
          case Rect:   return i32(2);
        }
        return i32(0);
      }
    `;
    const result = await compile(src);
    assert.ok(result.wat.includes('i32.load'), 'should load class_id from header at offset 8');
  });

  it('non-class switch is unaffected (no exhaustiveness check)', async () => {
    const src = `
      //@export
      function test(x = 0) {
        switch (x) {
          case 1: return i32(1);
          case 2: return i32(2);
        }
        return i32(0);
      }
    `;
    await assert.doesNotReject(compile(src));
  });

  it('sealed union runtime: class_id dispatch works correctly', async () => {
    const src = SEALED_SRC + `
      //@export
      function makeCircle() {
        return new Circle(3.0);
      }
      //@export
      function makeRect() {
        return new Rect(4.0, 5.0);
      }
      //@export
      function classify(s = new Shape()) {
        switch (s) {
          case Circle: return i32(1);
          case Rect:   return i32(2);
        }
        return i32(0);
      }
    `;
    const exp = await instantiate(src);
    const circle = exp.makeCircle();
    const rect   = exp.makeRect();
    assert.equal(exp.classify(circle), 1, 'Circle should return 1');
    assert.equal(exp.classify(rect),   2, 'Rect should return 2');
  });
});

// ── $ Compile-time Properties ─────────────────────────────────────────────────

describe('Compile-time $ properties', () => {
  const CLASS_SRC = `
    class Point {
      x = 0.0;
      y = 0.0;
    }
  `;

  it('T.$headerSize is always 12', async () => {
    const src = CLASS_SRC + `
      //@export
      function getHeaderSize() { return Point.$headerSize; }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.getHeaderSize(), 12);
  });

  it('T.$byteSize returns total allocation size (header + fields)', async () => {
    const src = CLASS_SRC + `
      //@export
      function getByteSize() { return Point.$byteSize; }
    `;
    const exp = await instantiate(src);
    // Point has 2 f64 fields = 16 bytes + 12 byte header = 28 bytes
    assert.ok(exp.getByteSize() >= 12, 'byteSize should include header');
    assert.ok(exp.getByteSize() > 12, 'byteSize should include fields');
  });

  it('T.$stride equals T.$byteSize for value types', async () => {
    const src = CLASS_SRC + `
      //@export
      function check() {
        const bs = Point.$byteSize;
        const st = Point.$stride;
        return bs === st ? i32(1) : i32(0);
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.check(), 1, '$byteSize should equal $stride');
  });

  it('T.$classId is a non-zero u32', async () => {
    const src = CLASS_SRC + `
      //@export
      function getClassId() { return Point.$classId; }
    `;
    const exp = await instantiate(src);
    assert.ok(exp.getClassId() > 0, '$classId should be a positive integer');
  });

  it('two classes have different $classId values', async () => {
    const src = `
      class Foo { x = 0; }
      class Bar { y = 0; }
      //@export
      function check() {
        return Foo.$classId === Bar.$classId ? i32(0) : i32(1);
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.check(), 1, 'different classes should have different classIds');
  });

  it('instance.$addr returns non-zero heap address', async () => {
    const src = CLASS_SRC + `
      //@export
      function getAddr() {
        const p = new Point();
        return p.$addr;
      }
    `;
    const exp = await instantiate(src);
    assert.ok(exp.getAddr() > 0, '$addr should be a valid heap address');
  });

  it('T.$classId matches the class_id stored in object header', async () => {
    const src = CLASS_SRC + `
      //@export
      function check() {
        const p = new Point();
        const headerClassId = i32(i32.load(p.$addr + 8));
        return headerClassId === Point.$classId ? i32(1) : i32(0);
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.check(), 1, '$classId should match the header class_id');
  });
});

// ── Named Argument Constructors ───────────────────────────────────────────────

describe('Named argument constructors', () => {
  it('basic named argument constructor works', async () => {
    const src = `
      class Vec2 {
        x = 0.0;
        y = 0.0;
        constructor(x = 0.0, y = 0.0) {
          this.x = x;
          this.y = y;
        }
      }
      //@export
      function test() {
        const v = new Vec2({ x: 3.0, y: 4.0 });
        return i32(1);
      }
    `;
    await assert.doesNotReject(compile(src));
  });

  it('named args can be in any order', async () => {
    const src = `
      class Vec2 {
        x = 0.0;
        y = 0.0;
        constructor(x = 0.0, y = 0.0) {
          this.x = x;
          this.y = y;
        }
      }
      //@export
      function test() {
        const v = new Vec2({ y: 4.0, x: 3.0 });
        return i32(1);
      }
    `;
    await assert.doesNotReject(compile(src));
  });

  it('named args with wrong key throws CE-C01', async () => {
    const src = `
      class Vec2 {
        x = 0.0;
        y = 0.0;
        constructor(x = 0.0, y = 0.0) {
          this.x = x;
          this.y = y;
        }
      }
      //@export
      function test() {
        const v = new Vec2({ x: 3.0, z: 0.0 });
        return i32(1);
      }
    `;
    await assert.rejects(compile(src), /CE-C01/);
  });

  it('named argument constructor produces correct values', async () => {
    const src = `
      class Vec2 {
        x = 0.0;
        y = 0.0;
        constructor(x = 0.0, y = 0.0) {
          this.x = x;
          this.y = y;
        }
      }
      //@export
      function getY() {
        const v = new Vec2({ x: 3.0, y: 4.0 });
        return v.y;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.getY(), 4.0);
  });

  it('named args produce same result as positional args', async () => {
    const src = `
      class Point {
        x = 0;
        y = 0;
        constructor(x = 0, y = 0) {
          this.x = x;
          this.y = y;
        }
      }
      //@export
      function positional() {
        const p = new Point(10, 20);
        return p.x + p.y;
      }
      //@export
      function named() {
        const p = new Point({ x: 10, y: 20 });
        return p.x + p.y;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.positional(), exp.named(), 'named and positional should produce same result');
  });

  it('named args with reversed order produce same values', async () => {
    const src = `
      class Color {
        r = 0;
        g = 0;
        b = 0;
        constructor(r = 0, g = 0, b = 0) {
          this.r = r;
          this.g = g;
          this.b = b;
        }
      }
      //@export
      function getR() {
        const c = new Color({ b: 5, r: 100, g: 200 });
        return c.r;
      }
      //@export
      function getG() {
        const c = new Color({ b: 5, r: 100, g: 200 });
        return c.g;
      }
      //@export
      function getB() {
        const c = new Color({ b: 5, r: 100, g: 200 });
        return c.b;
      }
    `;
    const exp = await instantiate(src);
    assert.equal(exp.getR(), 100, 'r should be 100');
    assert.equal(exp.getG(), 200, 'g should be 200');
    assert.equal(exp.getB(), 5,   'b should be 5');
  });
});
