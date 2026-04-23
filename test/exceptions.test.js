/**
 * @fileoverview Exception handling tests.
 */

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { compileSource } from '../src/compiler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STD_ROOT = join(ROOT, 'std');
const readFile = p => readFileSync(p, 'utf8');

async function instantiate(source) {
  const { wasm } = await compileSource(source, '<test>', { readFile, stdRoot: STD_ROOT });
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

describe('exceptions — throw/catch', () => {
  it('catches a typed exception', async () => {
    const exp = await instantiate(`
      import { ValueError } from 'std/error';
      //@export
      function run() {
        try {
          throw new ValueError('bad');
        } catch (e) {
          if (e instanceof ValueError) { return 1; }
          else throw e;
        }
      }
    `);
    assert.equal(exp.run(), 1);
  });
});

describe('exceptions — catch chain', () => {
  it('rethrows non-matching errors', async () => {
    const exp = await instantiate(`
      import { ValueError, IOError } from 'std/error';
      //@export
      function run(flag = 0) {
        try {
          if (flag === 0) throw new ValueError('v');
          throw new IOError('i');
        } catch (e) {
          if (e instanceof ValueError) { return 1; }
          else throw e;
        }
        return 0;
      }
    `);
    assert.equal(exp.run(0), 1);
    assert.throws(() => exp.run(1));
  });
});

describe('exceptions — finally', () => {
  it('runs finally on normal path', async () => {
    const exp = await instantiate(`
      import { ValueError } from 'std/error';
      //@export
      function run(flag = 0) {
        let x = 1;
        try {
          if (flag === 1) throw new ValueError('x');
          x = 2;
        } catch (e) {
          x = 3;
        } finally {
          x = x + 10;
        }
        return x;
      }
    `);
    assert.equal(exp.run(0), 12);
  });
});

describe('exceptions — CE-CF09', () => {
  it('requires catch chain exhaustiveness', async () => {
    await assert.rejects(
      () => compileSource(`
        import { ValueError } from 'std/error';
        function f(x = 0) {
          try { throw new ValueError('oops'); }
          catch (e) { if (e instanceof ValueError) { return 1; } }
        }
      `, '<test>', { readFile, stdRoot: STD_ROOT }),
      /CE-CF09/
    );
  });
});

describe('exceptions — try/finally', () => {
  it('compiles try/finally without catch', async () => {
    const exp = await instantiate(`
      import { ValueError } from 'std/error';
      //@export
      function run(flag = 0) {
        let x = 0;
        try {
          if (flag === 1) throw new ValueError('x');
          x = 1;
        } finally {
          x = x + 10;
        }
        return x;
      }
    `);
    assert.equal(exp.run(0), 11);
  });
});

describe('exceptions — unreachable', () => {
  it('compiles unreachable()', async () => {
    const exp = await instantiate(`
      //@export
      function boom() { unreachable(); }
    `);
    assert.throws(() => exp.boom());
  });
});

describe('exceptions — std/error', () => {
  it('constructs BoundsError and MathError', async () => {
    const exp = await instantiate(`
      import { BoundsError, MathError } from 'std/error';
      //@export
      function run() {
        const a = new BoundsError('b');
        const m = new MathError('m');
        return a.message.length + m.message.length;
      }
    `);
    assert.equal(exp.run(), 2);
  });
});
