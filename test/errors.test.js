/**
 * @fileoverview Tests for CE- error codes introduced in the compile error overhaul.
 * Covers: CompileError class, ceErr helper, validator CE codes, typecheck CE codes.
 */

import { strict as assert } from 'assert';
import { parseSource } from '../src/parser.js';
import { validate }    from '../src/validator.js';
import { inferTypes }  from '../src/typecheck.js';
import { CompileError, ceErr } from '../src/errors.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateSrc(src) {
  return validate(parseSource(src), '<test>');
}

function inferSrc(src) {
  return inferTypes(parseSource(src), '<test>');
}

function rejectsValidator(src, codePattern) {
  assert.throws(() => validateSrc(src), new RegExp(codePattern));
}

function rejectsTypecheck(src, codePattern) {
  assert.throws(() => inferSrc(src), new RegExp(codePattern));
}

function acceptsValidator(src) {
  assert.doesNotThrow(() => validateSrc(src));
}

function acceptsTypecheck(src) {
  assert.doesNotThrow(() => inferSrc(src));
}

// ── CompileError and ceErr ────────────────────────────────────────────────────

describe('CompileError class', () => {
  it('message includes code and text', () => {
    const e = new CompileError('CE-V02', "undeclared identifier 'foo'");
    assert.equal(e.name, 'CompileError');
    assert.match(e.message, /CE-V02/);
    assert.match(e.message, /undeclared identifier 'foo'/);
    assert.equal(e.code, 'CE-V02');
  });

  it('message includes file:line:col when location provided', () => {
    const e = new CompileError('CE-V01', "cannot reassign const 'x'", {
      filename: 'test.js', line: 5, col: 3,
    });
    assert.match(e.message, /CE-V01/);
    assert.match(e.message, /test\.js:5:3/);
    assert.equal(e.filename, 'test.js');
    assert.equal(e.line, 5);
    assert.equal(e.col, 3);
  });

  it('ceErr builds from AST node loc', () => {
    const node = { loc: { start: { line: 10, column: 4 } } };
    const e = ceErr('CE-T02', 'type mismatch', node, 'file.js');
    assert.match(e.message, /CE-T02/);
    assert.match(e.message, /file\.js:10:5/);  // column is 0-indexed → displayed as 1-indexed
    assert.equal(e.col, 5);
  });

  it('ceErr handles null node gracefully', () => {
    const e = ceErr('CE-V02', 'test', null, 'f.js');
    assert.match(e.message, /CE-V02/);
    assert.match(e.message, /f\.js:\?:\?/);
  });
});

// ── Validator CE codes ────────────────────────────────────────────────────────

describe('validator CE codes', () => {

  describe('CE-A02 — banned dynamic code', () => {
    it('eval() throws CE-A02', () => rejectsValidator(
      `function f(x = 0) { eval('x'); }`, 'CE-A02'
    ));
    it('new Function() throws CE-A02', () => rejectsValidator(
      `function f(x = 0) { new Function('return 1'); }`, 'CE-A02'
    ));
    it('JSON.parse throws CE-A02', () => rejectsValidator(
      `function f(x = 0) { JSON.parse('{}'); }`, 'CE-A02'
    ));
  });

  describe('CE-A03 — prototype access', () => {
    it('__proto__ access throws CE-A03', () => rejectsValidator(
      `function f(x = 0) { return x.__proto__; }`, 'CE-A03'
    ));
    it('prototype access throws CE-A03', () => rejectsValidator(
      `function f(x = 0) { return x.prototype; }`, 'CE-A03'
    ));
  });

  describe('CE-A04 — nested destructuring', () => {
    it('nested array destructuring throws CE-A04', () => rejectsValidator(
      `function f(x = 0) { let [[a]] = x; }`, 'CE-A04'
    ));
    it('nested object destructuring throws CE-A04', () => rejectsValidator(
      `function f(x = 0) { let { a: { b } } = x; }`, 'CE-A04'
    ));
    it('flat destructuring is allowed', () => acceptsValidator(
      `function f(x = 0) { let [a, b] = x; }`
    ));
  });

  describe('CE-A06 — delete', () => {
    it('delete throws CE-A06', () => rejectsValidator(
      `function f(x = 0) { delete x.y; }`, 'CE-A06'
    ));
  });

  describe('CE-C05 — this outside method', () => {
    it('this in top-level function throws CE-C05', () => rejectsValidator(
      `function f(x = 0) { return this; }`, 'CE-C05'
    ));
    it('this inside method is OK', () => acceptsValidator(
      `class Foo { bar(x = 0) { return this; } }`
    ));
  });

  describe('CE-CF02 — switch fallthrough', () => {
    it('switch case without break throws CE-CF02', () => rejectsValidator(
      `function f(x = 0) { switch (x) { case 1: let y = 1; case 2: return 0; } }`,
      'CE-CF02'
    ));
    it('switch case with break is OK', () => acceptsValidator(
      `function f(x = 0) { switch (x) { case 1: return 1; case 2: return 2; } }`
    ));
    it('empty case (intentional fallthrough group) is OK', () => acceptsValidator(
      `function f(x = 0) { switch (x) { case 1: case 2: return 0; } }`
    ));
    it('last case without break is OK', () => acceptsValidator(
      `function f(x = 0) { switch (x) { case 1: return 1; } }`
    ));
  });

  describe('CE-CF04 — break/continue outside loop (validator tracks loop depth)', () => {
    // Note: bare break/continue outside a loop are caught by the parser as syntax errors.
    // The validator's loopDepth tracking ensures valid usage inside loops is not flagged.
    it('break inside for-of is OK', () => acceptsValidator(
      `function f(x = 0) { for (const i of x) { break; } }`
    ));
    it('break inside while is OK', () => acceptsValidator(
      `function f(x = 0) { while (x > 0) { break; } }`
    ));
    it('continue inside for is OK', () => acceptsValidator(
      `function f(x = 0) { for (let i = 0; i < 10; i = i + 1) { continue; } }`
    ));
    it('break inside switch is OK', () => acceptsValidator(
      `function f(x = 0) { switch (x) { case 1: break; } }`
    ));
  });

  describe('CE-CF05 — unreachable code', () => {
    it('code after return throws CE-CF05', () => rejectsValidator(
      `function f(x = 0) { return 1; let y = 2; }`, 'CE-CF05'
    ));
    it('code after throw throws CE-CF05', () => rejectsValidator(
      `function f(x = 0) { throw 1; let y = 2; }`, 'CE-CF05'
    ));
    it('return at end is OK', () => acceptsValidator(
      `function f(x = 0) { let y = 2; return y; }`
    ));
  });

  describe('CE-F01 — parameter without default', () => {
    it('undefaulted param throws CE-F01', () => rejectsValidator(
      `function f(x) { return x; }`, 'CE-F01'
    ));
    it('param with default is OK', () => acceptsValidator(
      `function f(x = 0) { return x; }`
    ));
  });

  describe('CE-V04 — duplicate declaration', () => {
    // Note: acorn already catches many duplicate declaration cases as parse errors.
    // CE-V04 fires for cases the validator encounters after parsing succeeds.
    it('same name in different blocks is OK', () => acceptsValidator(
      `function f(x = 0) { { let a = 1; } { let a = 2; } }`
    ));
  });

  describe('CE-V05 — $-prefixed identifier', () => {
    it('variable starting with $ throws CE-V05', () => rejectsValidator(
      `function f(x = 0) { let $bad = 1; }`, 'CE-V05'
    ));
    it('function starting with $ throws CE-V05', () => rejectsValidator(
      `function $bad(x = 0) {}`, 'CE-V05'
    ));
    it('class starting with $ throws CE-V05', () => rejectsValidator(
      `class $Bad {}`, 'CE-V05'
    ));
  });

  describe('CE-V06 — var', () => {
    it('var throws CE-V06', () => rejectsValidator(
      `function f(x = 0) { var y = 1; }`, 'CE-V06'
    ));
  });
});

// ── Typecheck CE codes ────────────────────────────────────────────────────────

describe('typecheck CE codes', () => {

  describe('CE-V01 — const reassignment', () => {
    it('reassigning const throws CE-V01', () => rejectsTypecheck(
      `const x = 1; x = 2;`, 'CE-V01'
    ));
    it('reassigning let is OK', () => acceptsTypecheck(
      `let x = 1; x = 2;`
    ));
  });

  describe('CE-V02 — undeclared identifier', () => {
    it('calling undeclared function throws CE-V02', () => rejectsTypecheck(
      `function f(x = 0) { jj(); }`, 'CE-V02'
    ));
    it('reading undeclared variable throws CE-V02', () => rejectsTypecheck(
      `function f(x = 0) { return fooBarUndeclared; }`, 'CE-V02'
    ));
    it('declared function is OK', () => acceptsTypecheck(
      `function helper(x = 0) { return x; } function f(x = 0) { return helper(x); }`
    ));
    it('builtin names are OK', () => acceptsTypecheck(
      `function f(x = 0) { return true; }`
    ));
  });

  describe('CE-T02 — implicit type coercion', () => {
    it('i32 + f64 without cast throws CE-T02', () => rejectsTypecheck(
      `const x = 1 + 1.0;`, 'CE-T02'
    ));
  });

  describe('CE-T05 — bool in arithmetic', () => {
    it('bool + number throws CE-T05', () => rejectsTypecheck(
      `const x = true + 1;`, 'CE-T05'
    ));
    it('bool in comparison is OK', () => acceptsTypecheck(
      `const x = true === false;`
    ));
  });

  describe('CE-T06 — abstract type instantiation', () => {
    it('new iter() throws CE-T06', () => rejectsTypecheck(
      `const x = new iter();`, 'CE-T06'
    ));
    it('new Integer() throws CE-T06', () => rejectsTypecheck(
      `const x = new Integer();`, 'CE-T06'
    ));
  });

  describe('CE-T07 — return type mismatch', () => {
    it('mismatched return types throws CE-T07', () => rejectsTypecheck(
      `function f(x = 0) { if (x > 0) return 1; return 1.0; }`, 'CE-T07'
    ));
  });

  describe('CE-T09 — class in template literal without Symbol.toStr', () => {
    it('class without Symbol.toStr in template literal throws CE-T09', () => rejectsTypecheck(
      `class Foo {} function f(x = Foo) { return \`val: \${x}\`; }`, 'CE-T09'
    ));
    it('primitive in template literal is OK', () => acceptsTypecheck(
      `function f(x = 0) { return \`val: \${x}\`; }`
    ));
  });

  describe('CE-CF06 — ternary type mismatch', () => {
    it('ternary with incompatible types throws CE-CF06', () => rejectsTypecheck(
      `function f(x = 0) { return x > 0 ? 1 : 1.0; }`, 'CE-CF06'
    ));
    it('ternary with same type is OK', () => acceptsTypecheck(
      `function f(x = 0) { return x > 0 ? 1 : 2; }`
    ));
  });

  describe('CE-CF07 — non-exhaustive sealed switch', () => {
    it('sealed switch missing variant throws CE-CF07', () => rejectsTypecheck(`
      class Shape { static $variants = []; }
      class Circle extends Shape {}
      class Square extends Shape {}
      function describe(s = Shape) {
        switch (s) {
          case Circle: return 1;
        }
      }
    `, 'CE-CF07'));
  });

  describe('CE-A01 — bracket notation on non-array', () => {
    it('bracket notation on class instance throws CE-A01', () => rejectsTypecheck(`
      class Foo {}
      function f(x = Foo) { return x[0]; }
    `, 'CE-A01'));
    it('bracket notation on bool throws CE-A01', () => rejectsTypecheck(
      `function f(x = false) { return x[0]; }`, 'CE-A01'
    ));
  });

  describe('CE-A11 — List invalid element type', () => {
    it('List with class element type throws CE-A11', () => rejectsTypecheck(`
      class Foo {}
      function f(x = 0) { const arr = new List(Foo, 10); }
    `, 'CE-A11'));
    it('List with numeric type is OK', () => acceptsTypecheck(
      `function f(x = 0) { const arr = new List(i32, 10); }`
    ));
  });
});
