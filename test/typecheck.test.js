/**
 * @fileoverview Type inference test suite.
 */

import { strict as assert } from 'assert';
import { parseSource } from '../src/parser.js';
import { inferTypes }  from '../src/typecheck.js';
import { TYPES }       from '../src/types.js';

/**
 * Parse and infer types for a source string.
 * @param {string} src
 * @returns {{ ast: object, signatures: Map<string, any> }}
 */
function infer(src) {
  const ast = parseSource(src);
  return inferTypes(ast);
}

/**
 * Get the `_type` of the first expression in the init of the first variable declaration.
 * @param {string} src  e.g. `const x = 0;`
 * @returns {import('../src/types.js').TypeInfo}
 */
function inferLiteralType(src) {
  const { ast } = infer(src);
  const decl = ast.body[0];
  assert.equal(decl.type, 'VariableDeclaration');
  return decl.declarations[0].init._type;
}

// ── Literal inference ─────────────────────────────────────────────────────────

describe('typecheck — literal inference', () => {

  it('integer literal 0 → isize', () => {
    const t = inferLiteralType('const x = 0;');
    assert.equal(t, TYPES.isize);
  });

  it('integer literal 42 → isize', () => {
    const t = inferLiteralType('const x = 42;');
    assert.equal(t, TYPES.isize);
  });

  it('float literal 0.0 → f64', () => {
    const t = inferLiteralType('const x = 0.0;');
    assert.equal(t, TYPES.f64);
  });

  it('float literal 3.14 → f64', () => {
    const t = inferLiteralType('const x = 3.14;');
    assert.equal(t, TYPES.f64);
  });

  it('bool literal true → bool', () => {
    const t = inferLiteralType('const x = true;');
    assert.equal(t, TYPES.bool);
  });

  it('bool literal false → bool', () => {
    const t = inferLiteralType('const x = false;');
    assert.equal(t, TYPES.bool);
  });

  it('string literal "" → str', () => {
    const t = inferLiteralType('const x = "";');
    assert.equal(t, TYPES.str);
  });

});

// ── Cast call inference ───────────────────────────────────────────────────────

describe('typecheck — cast call inference', () => {

  it('u8(0) → u8', () => {
    const t = inferLiteralType('const x = u8(0);');
    assert.equal(t, TYPES.u8);
  });

  it('i32(0) → i32', () => {
    const t = inferLiteralType('const x = i32(0);');
    assert.equal(t, TYPES.i32);
  });

  it('f32(0.0) → f32', () => {
    const t = inferLiteralType('const x = f32(0.0);');
    assert.equal(t, TYPES.f32);
  });

  it('i64(0) → i64', () => {
    const t = inferLiteralType('const x = i64(0);');
    assert.equal(t, TYPES.i64);
  });

  it('usize(0) → usize', () => {
    const t = inferLiteralType('const x = usize(0);');
    assert.equal(t, TYPES.usize);
  });

});

// ── Binary arithmetic inference ───────────────────────────────────────────────

describe('typecheck — arithmetic inference', () => {

  it('isize + isize → isize', () => {
    const { ast } = infer('const r = 1 + 2;');
    const t = ast.body[0].declarations[0].init._type;
    assert.equal(t, TYPES.isize);
  });

  it('f64 + f64 → f64', () => {
    const { ast } = infer('const r = 1.0 + 2.0;');
    const t = ast.body[0].declarations[0].init._type;
    assert.equal(t, TYPES.f64);
  });

  it('f64 * f64 → f64', () => {
    const { ast } = infer('const r = 3.0 * 2.0;');
    const t = ast.body[0].declarations[0].init._type;
    assert.equal(t, TYPES.f64);
  });

  it('isize > isize → bool', () => {
    const { ast } = infer('const r = 1 > 2;');
    const t = ast.body[0].declarations[0].init._type;
    assert.equal(t, TYPES.bool);
  });

  it('mixed integer + float without cast → type error', () => {
    assert.throws(
      () => infer('const r = 1 + 2.0;'),
      /type error|cannot mix/i
    );
  });

  it('mixed f64 - isize without cast → type error', () => {
    assert.throws(
      () => infer('const r = 1.0 - 2;'),
      /type error|cannot mix/i
    );
  });

});

// ── Function signature inference ─────────────────────────────────────────────

describe('typecheck — function signatures', () => {

  it('infers param types from defaults', () => {
    const { signatures } = infer('function add(a = 0, b = 0) { return a + b; }');
    const sig = signatures.get('add');
    assert.ok(sig, 'missing signature for add');
    assert.equal(sig.params[0].type, TYPES.isize);
    assert.equal(sig.params[1].type, TYPES.isize);
  });

  it('infers isize return type from integer arithmetic', () => {
    const { signatures } = infer('function add(a = 0, b = 0) { return a + b; }');
    assert.equal(signatures.get('add').returnType, TYPES.isize);
  });

  it('infers f64 param and return from float defaults', () => {
    const { signatures } = infer('function lerp(a = 0.0, b = 0.0, t = 0.0) { return a + (b - a) * t; }');
    const sig = signatures.get('lerp');
    assert.ok(sig);
    assert.equal(sig.params[0].type, TYPES.f64);
    assert.equal(sig.returnType, TYPES.f64);
  });

  it('no-return function → void return type', () => {
    const { signatures } = infer('function noop(x = 0) {}');
    assert.equal(signatures.get('noop').returnType, TYPES.void);
  });

  it('infers u8 param from cast default', () => {
    const { signatures } = infer('function f(x = u8(0)) { return x; }');
    const sig = signatures.get('f');
    assert.ok(sig);
    assert.equal(sig.params[0].type, TYPES.u8);
  });

});

// ── Local variable inference ─────────────────────────────────────────────────

describe('typecheck — local variable inference', () => {

  it('local const inferred from initializer', () => {
    const { ast } = infer('function f(x = 0) { const y = x; return y; }');
    const fn   = ast.body[0];
    const body = fn.body.body;
    const decl = body[0];
    assert.equal(decl.type, 'VariableDeclaration');
    assert.equal(decl.declarations[0]._type, TYPES.isize);
  });

  it('local let inferred from arithmetic', () => {
    const { ast } = infer('function double(x = 0) { let y = x + x; return y; }');
    const fn    = ast.body[0];
    const decl  = fn.body.body[0];
    assert.equal(decl.declarations[0]._type, TYPES.isize);
  });

  it('local float variable', () => {
    const { ast } = infer('function f(x = 0.0) { const y = x + 1.0; return y; }');
    const fn   = ast.body[0];
    const decl = fn.body.body[0];
    assert.equal(decl.declarations[0]._type, TYPES.f64);
  });

});
