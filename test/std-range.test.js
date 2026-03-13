/**
 * @fileoverview Tests for std/range — Range-based for-of iteration.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { compileSource } from '../src/compiler.js';

/**
 * @param {string} src
 * @param {Record<string, any>} [imports]
 */
async function compile(src) {
  const { wasm } = await compileSource(src, 'test-range.js');
  const { instance } = await WebAssembly.instantiate(wasm);
  return instance.exports;
}

describe('std/range', () => {
  describe('basic iteration', () => {
    it('sums 0..4 (exclusive end)', async () => {
      const { sum } = await compile(`
        import { Range } from 'std/range';
        //@export
        function sum() {
          let s = 0;
          for (const i of new Range(0, 5)) { s = s + i; }
          return s;
        }
      `);
      assert.equal(sum(), 10); // 0+1+2+3+4
    });

    it('counts iterations', async () => {
      const { count } = await compile(`
        import { Range } from 'std/range';
        //@export
        function count() {
          let n = 0;
          for (const i of new Range(0, 7)) { n = n + 1; }
          return n;
        }
      `);
      assert.equal(count(), 7);
    });

    it('empty range (start === end) iterates zero times', async () => {
      const { count } = await compile(`
        import { Range } from 'std/range';
        //@export
        function count() {
          let n = 0;
          for (const i of new Range(3, 3)) { n = n + 1; }
          return n;
        }
      `);
      assert.equal(count(), 0);
    });

    it('last value is end - 1', async () => {
      const { last } = await compile(`
        import { Range } from 'std/range';
        //@export
        function last() {
          let v = -1;
          for (const i of new Range(0, 5)) { v = i; }
          return v;
        }
      `);
      assert.equal(last(), 4);
    });
  });

  describe('step parameter', () => {
    it('step=2 sums evens', async () => {
      const { sum } = await compile(`
        import { Range } from 'std/range';
        //@export
        function sum() {
          let s = 0;
          for (const i of new Range(0, 10, 2)) { s = s + i; }
          return s;
        }
      `);
      assert.equal(sum(), 20); // 0+2+4+6+8
    });

    it('step=3', async () => {
      const { count } = await compile(`
        import { Range } from 'std/range';
        //@export
        function count() {
          let n = 0;
          for (const i of new Range(0, 9, 3)) { n = n + 1; }
          return n;
        }
      `);
      assert.equal(count(), 3); // 0,3,6
    });

    it('negative step iterates downward', async () => {
      const { sum } = await compile(`
        import { Range } from 'std/range';
        //@export
        function sum() {
          let s = 0;
          for (const i of new Range(4, -1, -1)) { s = s + i; }
          return s;
        }
      `);
      assert.equal(sum(), 10); // 4+3+2+1+0
    });

    it('negative step count', async () => {
      const { count } = await compile(`
        import { Range } from 'std/range';
        //@export
        function count() {
          let n = 0;
          for (const i of new Range(5, 0, -1)) { n = n + 1; }
          return n;
        }
      `);
      assert.equal(count(), 5); // 5,4,3,2,1
    });
  });

  describe('control flow', () => {
    it('break exits early', async () => {
      const { count } = await compile(`
        import { Range } from 'std/range';
        //@export
        function count() {
          let n = 0;
          for (const i of new Range(0, 100)) {
            if (i === 5) { break; }
            n = n + 1;
          }
          return n;
        }
      `);
      assert.equal(count(), 5);
    });

    it('nested ranges (multiplication table sum)', async () => {
      const { sum } = await compile(`
        import { Range } from 'std/range';
        //@export
        function sum() {
          let s = 0;
          for (const i of new Range(0, 3)) {
            for (const j of new Range(0, 3)) {
              s = s + 1;
            }
          }
          return s;
        }
      `);
      assert.equal(sum(), 9); // 3*3
    });
  });

  describe('without explicit import', () => {
    it('Range works without import statement', async () => {
      const { sum } = await compile(`
        //@export
        function sum() {
          let s = 0;
          for (const i of new Range(0, 5)) { s = s + i; }
          return s;
        }
      `);
      assert.equal(sum(), 10);
    });
  });
});
