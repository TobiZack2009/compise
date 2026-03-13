/**
 * @fileoverview std/string tests.
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

async function instantiate(source) {
  const { wasm } = await compileSource(source);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

// ── length ────────────────────────────────────────────────────────────────────

describe('std/string — length', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function helloLen()  { const s = 'hello';  return s.length; }
      //@export
      function emptyLen()  { const s = '';        return s.length; }
      //@export
      function longerLen() { const s = 'abcdefghij'; return s.length; }
    `);
  });

  it("'hello'.length → 5",      () => assert.equal(exp.helloLen(), 5));
  it("''.length → 0",           () => assert.equal(exp.emptyLen(), 0));
  it("'abcdefghij'.length → 10",() => assert.equal(exp.longerLen(), 10));
});

// ── charAt ────────────────────────────────────────────────────────────────────

describe('std/string — charAt', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function charH()    { const s = 'hello'; return s.charAt(0); }
      //@export
      function charE()    { const s = 'hello'; return s.charAt(1); }
      //@export
      function charOob()  { const s = 'hi';    return s.charAt(5); }
    `);
  });

  it("'hello'.charAt(0) → 104 ('h')", () => assert.equal(exp.charH(), 104));
  it("'hello'.charAt(1) → 101 ('e')", () => assert.equal(exp.charE(), 101));
  it("'hi'.charAt(5) → -1 (oob)",     () => assert.equal(exp.charOob(), -1));
});

// ── slice ─────────────────────────────────────────────────────────────────────

describe('std/string — slice', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function sliceLen()     {
        const s = 'hello world';
        return s.slice(6, 11).length;
      }
      //@export
      function sliceFirst()   {
        const s = 'hello world';
        return s.slice(6, 11).charAt(0);
      }
      //@export
      function sliceEmpty()   {
        const s = 'hello';
        return s.slice(2, 2).length;
      }
      //@export
      function sliceClamp()   {
        const s = 'hello';
        return s.slice(0, 100).length;
      }
    `);
  });

  it("'hello world'.slice(6,11).length → 5",       () => assert.equal(exp.sliceLen(), 5));
  it("'hello world'.slice(6,11).charAt(0) → 'w'",  () => assert.equal(exp.sliceFirst(), 119));
  it("'hello'.slice(2,2).length → 0",              () => assert.equal(exp.sliceEmpty(), 0));
  it("'hello'.slice(0,100).length → 5 (clamped)",  () => assert.equal(exp.sliceClamp(), 5));
});

// ── concat ────────────────────────────────────────────────────────────────────

describe('std/string — concat', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function concatLen() {
        const a = 'foo';
        const b = 'bar';
        return a.concat(b).length;
      }
      //@export
      function concatChar() {
        const a = 'abc';
        const b = 'def';
        return a.concat(b).charAt(3);
      }
    `);
  });

  it("'foo'.concat('bar').length → 6",        () => assert.equal(exp.concatLen(), 6));
  it("'abc'.concat('def').charAt(3) → 'd'",   () => assert.equal(exp.concatChar(), 100));
});

// ── indexOf ───────────────────────────────────────────────────────────────────

describe('std/string — indexOf', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function findWorld()  {
        const s = 'hello world';
        const n = 'world';
        return s.indexOf(n);
      }
      //@export
      function findMiss()   {
        const s = 'hello world';
        const n = 'xyz';
        return s.indexOf(n);
      }
      //@export
      function findStart()  {
        const s = 'hello';
        const n = 'hel';
        return s.indexOf(n);
      }
    `);
  });

  it("'hello world'.indexOf('world') → 6",  () => assert.equal(exp.findWorld(), 6));
  it("'hello world'.indexOf('xyz') → -1",   () => assert.equal(exp.findMiss(), -1));
  it("'hello'.indexOf('hel') → 0",          () => assert.equal(exp.findStart(), 0));
});

// ── startsWith / endsWith ─────────────────────────────────────────────────────

describe('std/string — startsWith / endsWith', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function swYes()  { const s = 'hello'; const p = 'hel'; return s.startsWith(p) ? 1 : 0; }
      //@export
      function swNo()   { const s = 'hello'; const p = 'ell'; return s.startsWith(p) ? 1 : 0; }
      //@export
      function ewYes()  { const s = 'hello'; const sfx = 'llo'; return s.endsWith(sfx) ? 1 : 0; }
      //@export
      function ewNo()   { const s = 'hello'; const sfx = 'hel'; return s.endsWith(sfx) ? 1 : 0; }
    `);
  });

  it("'hello'.startsWith('hel') → true",  () => assert.equal(exp.swYes(), 1));
  it("'hello'.startsWith('ell') → false", () => assert.equal(exp.swNo(), 0));
  it("'hello'.endsWith('llo') → true",    () => assert.equal(exp.ewYes(), 1));
  it("'hello'.endsWith('hel') → false",   () => assert.equal(exp.ewNo(), 0));
});

// ── includes ─────────────────────────────────────────────────────────────────

describe('std/string — includes', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function inclYes()  {
        const s = 'hello world';
        const n = 'lo wo';
        return s.includes(n) ? 1 : 0;
      }
      //@export
      function inclNo()   {
        const s = 'hello world';
        const n = 'xyz';
        return s.includes(n) ? 1 : 0;
      }
    `);
  });

  it("'hello world'.includes('lo wo') → true",  () => assert.equal(exp.inclYes(), 1));
  it("'hello world'.includes('xyz') → false",   () => assert.equal(exp.inclNo(), 0));
});

// ── equals ────────────────────────────────────────────────────────────────────

describe('std/string — equals', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      //@export
      function eqSame()   {
        const a = 'hello';
        const b = 'hello';
        return a.equals(b) ? 1 : 0;
      }
      //@export
      function eqDiff()   {
        const a = 'hello';
        const b = 'world';
        return a.equals(b) ? 1 : 0;
      }
      //@export
      function eqSlice()  {
        const s = 'hello world';
        const t = s.slice(0, 5);
        const u = 'hello';
        return t.equals(u) ? 1 : 0;
      }
    `);
  });

  it("'hello'.equals('hello') → true",                () => assert.equal(exp.eqSame(), 1));
  it("'hello'.equals('world') → false",               () => assert.equal(exp.eqDiff(), 0));
  it("'hello world'.slice(0,5).equals('hello') → true", () => assert.equal(exp.eqSlice(), 1));
});

// ── String.from ───────────────────────────────────────────────────────────────

describe('std/string — String.from', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { String } from 'std/string';
      //@export
      function fromZero()    { return String.from(0).length; }
      //@export
      function fromPos()     { return String.from(42).length; }
      //@export
      function fromNeg()     { return String.from(-5).length; }
      //@export
      function fromDigit()   { return String.from(7).charAt(0); }
      //@export
      function fromNegSign() { return String.from(-1).charAt(0); }
    `);
  });

  it("String.from(0).length → 1",          () => assert.equal(exp.fromZero(), 1));
  it("String.from(42).length → 2",         () => assert.equal(exp.fromPos(), 2));
  it("String.from(-5).length → 2",         () => assert.equal(exp.fromNeg(), 2));
  it("String.from(7).charAt(0) → '7'",     () => assert.equal(exp.fromDigit(), 55));
  it("String.from(-1).charAt(0) → '-'",    () => assert.equal(exp.fromNegSign(), 45));
});
