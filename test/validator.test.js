/**
 * @fileoverview Validator test suite — banned construct detection.
 */

import { strict as assert } from 'assert';
import { parseSource } from '../src/parser.js';
import { validate }    from '../src/validator.js';

/**
 * Parse and validate a source string. Returns the validation result.
 * @param {string} src
 * @returns {{ warnings: string[] }}
 */
function check(src) {
  const ast = parseSource(src);
  return validate(ast);
}

/**
 * Assert that validating `src` throws an error matching `pattern`.
 * @param {string} src
 * @param {string|RegExp} pattern
 */
function rejects(src, pattern) {
  assert.throws(() => check(src), pattern ? new RegExp(pattern, 'i') : Error);
}

/**
 * Assert that validating `src` does not throw.
 * @param {string} src
 * @returns {{ warnings: string[] }}
 */
function accepts(src) {
  return assert.doesNotThrow(() => check(src));
}

// ── Banned constructs ─────────────────────────────────────────────────────────

describe('validator — banned constructs', () => {

  it('rejects eval()', () => {
    rejects(`function f(x = 0) { return eval('x'); }`, 'eval');
  });

  it('rejects new Function()', () => {
    rejects(`function f(x = 0) { return new Function('return 1'); }`, 'Function');
  });

  it('rejects with statement', () => {
    assert.throws(() => {
      const ast = parseSource(`with (obj) { x; }`);
      validate(ast);
    });
  });

  it('rejects for...in', () => {
    assert.throws(() => {
      const ast = parseSource(`for (let k in obj) {}`);
      validate(ast);
    });
  });

  it('rejects arguments identifier', () => {
    assert.throws(() => {
      const ast = parseSource(`function f(x = 0) { return arguments[0]; }`);
      validate(ast);
    });
  });

  it('rejects typeof in if condition', () => {
    rejects(`function f(x = 0) { if (typeof x === 'number') {} }`, 'typeof');
  });

  it('rejects typeof in nested condition', () => {
    rejects(`function f(x = 0) { if (typeof x) {} }`, 'typeof');
  });

  it('rejects delete', () => {
    // `delete obj.x` (property delete) is syntactically valid in strict/module mode;
    // the validator must reject it at the semantic level.
    rejects(`function f(obj = 0) { delete obj.x; }`, 'delete');
  });

  it('rejects standalone object literal', () => {
    rejects(`function f(x = 0) { const o = {}; return x; }`, 'object literal');
  });

  it('rejects generator function', () => {
    assert.throws(() => {
      const ast = parseSource(`function* gen(x = 0) { yield x; }`);
      validate(ast);
    });
  });

  it('rejects async function', () => {
    assert.throws(() => {
      const ast = parseSource(`async function f(x = 0) { return x; }`);
      validate(ast);
    });
  });

  it('rejects await expression', () => {
    assert.throws(() => {
      const ast = parseSource(`async function f(p = 0) { return await p; }`);
      validate(ast);
    });
  });

  it('rejects comma operator (SequenceExpression)', () => {
    assert.throws(() => {
      const ast = parseSource(`function f(x = 0) { return (x, x + 1); }`);
      validate(ast);
    });
  });

  it('rejects dynamic import()', () => {
    assert.throws(() => {
      const ast = parseSource(`async function f(x = 0) { return await import('./m.js'); }`);
      validate(ast);
    });
  });

  it('rejects Proxy', () => {
    rejects(`function f(x = 0) { return new Proxy(x, {}); }`, 'proxy');
  });

  it('rejects Reflect', () => {
    rejects(`function f(x = 0) { Reflect.apply(f, null, []); }`, 'reflect');
  });

  it('rejects JSON.parse', () => {
    rejects(`function f(s = "") { return JSON.parse(s); }`, 'JSON.parse');
  });

  it('rejects this outside class method', () => {
    rejects(`function f(x = 0) { return this.x; }`, 'this');
  });

  it('rejects Math.* without import', () => {
    rejects(`function f(x = 0) { return Math.sin(x); }`, 'Math');
  });

  it('rejects parameters without defaults', () => {
    rejects(`function f(a, b) { return a + b; }`, 'default');
  });

  it('rejects missing default on one parameter', () => {
    rejects(`function f(a = 0, b) { return a + b; }`, 'default');
  });

  // Bracket notation is now allowed (for array access); codegen/typecheck enforce valid use.

  // ── Allowed constructs ─────────────────────────────────────────────────────

  it('accepts valid function with defaults', () => {
    accepts(`function add(a = 0, b = 0) { return a + b; }`);
  });

  it('accepts cast calls', () => {
    accepts(`function f(x = 0) { return u8(x); }`);
  });

  it('accepts if/else', () => {
    accepts(`function max(a = 0, b = 0) { if (a > b) { return a; } else { return b; } }`);
  });

  it('accepts const declarations', () => {
    accepts(`function f(x = 0) { const y = x + 1; return y; }`);
  });

  it('accepts let declarations', () => {
    accepts(`function f(x = 0) { let y = x + 1; return y; }`);
  });

  it('accepts instanceof in condition', () => {
    accepts(`function f(x = 0) { if (x instanceof Object) { return 1; } return 0; }`);
  });

  // ── CE-V06: var is banned ───────────────────────────────────────────────────

  it('var throws CE-V06', () => {
    const ast = parseSource(`function f(x = 0) { var y = x + 1; return y; }`);
    assert.throws(() => validate(ast), /CE-V06/);
  });

});
