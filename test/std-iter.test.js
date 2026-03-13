/**
 * @fileoverview std/iter tests.
 */

import { strict as assert } from 'assert';
import { compileSource } from '../src/compiler.js';

async function instantiate(source) {
  const { wasm } = await compileSource(source);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

describe('std/iter — count', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { iter } from 'std/iter';
      //@export
      function countThree() {
        const arr = [10, 20, 30];
        return iter(arr).count();
      }
      //@export
      function countFive() {
        const arr = [1, 2, 3, 4, 5];
        return iter(arr).count();
      }
      //@export
      function countZero() {
        const arr = [];
        return iter(arr).count();
      }
    `);
  });

  it('iter([10,20,30]).count() → 3', () => assert.equal(exp.countThree(), 3));
  it('iter([1..5]).count() → 5',    () => assert.equal(exp.countFive(), 5));
  it('iter([]).count() → 0',        () => assert.equal(exp.countZero(), 0));
});

describe('std/iter — take', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { iter } from 'std/iter';
      //@export
      function takeThree() {
        const arr = [1, 2, 3, 4, 5];
        return iter(arr).take(3).count();
      }
      //@export
      function takeZero() {
        const arr = [1, 2, 3];
        return iter(arr).take(0).count();
      }
    `);
  });

  it('iter([1..5]).take(3).count() → 3', () => assert.equal(exp.takeThree(), 3));
  it('iter([1,2,3]).take(0).count() → 0', () => assert.equal(exp.takeZero(), 0));
});

describe('std/iter — map', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { iter } from 'std/iter';
      function double(x = 0) { return x * 2; }
      //@export
      function mapCount() {
        const arr = [1, 2, 3];
        return iter(arr).map(double).count();
      }
    `);
  });

  it('iter([1,2,3]).map(double).count() → 3', () => assert.equal(exp.mapCount(), 3));
});

describe('std/iter — filter', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { iter } from 'std/iter';
      function isEven(x = 0) { return x % 2 === 0 ? 1 : 0; }
      //@export
      function filterCount() {
        const arr = [1, 2, 3, 4, 5, 6];
        return iter(arr).filter(isEven).count();
      }
    `);
  });

  it('iter([1..6]).filter(isEven).count() → 3', () => assert.equal(exp.filterCount(), 3));
});

describe('std/iter — collect', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { iter } from 'std/iter';
      //@export
      function collectLen() {
        const arr = [5, 6, 7];
        const dst = iter(arr).collect();
        return dst.length;
      }
    `);
  });

  it('iter([5,6,7]).collect().length → 3', () => assert.equal(exp.collectLen(), 3));
});

describe('std/iter — chained operations', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { iter } from 'std/iter';
      function double(x = 0) { return x * 2; }
      function isGt4(x = 0) { return x > 4 ? 1 : 0; }
      //@export
      function chainedCount() {
        const arr = [1, 2, 3, 4, 5];
        return iter(arr).map(double).filter(isGt4).count();
      }
    `);
  });

  // double([1,2,3,4,5]) = [2,4,6,8,10], filter(>4) = [6,8,10], count = 3
  it('map+filter chain count → 3', () => assert.equal(exp.chainedCount(), 3));
});
