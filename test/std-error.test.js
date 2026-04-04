/**
 * @fileoverview std/error tests — error class hierarchy.
 */

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { compileSource } from '../src/compiler.js';

const ROOT    = fileURLToPath(new URL('..', import.meta.url));
const STD_ROOT = join(ROOT, 'std');
const readFile = p => readFileSync(p, 'utf8');

async function instantiate(source) {
  const { wasm } = await compileSource(source, '<test>', { readFile, stdRoot: STD_ROOT });
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

describe('std/error — AppError', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { AppError } from 'std/error';
      //@export
      function makeError() {
        const e = new AppError('oops');
        return e.message.length;
      }
    `);
  });
  it('AppError.message is accessible', () => assert.equal(exp.makeError(), 4));
});

describe('std/error — ValueError', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { ValueError } from 'std/error';
      //@export
      function makeValErr() {
        const e = new ValueError('bad');
        return e.message.length;
      }
    `);
  });
  it('ValueError.message is accessible', () => assert.equal(exp.makeValErr(), 3));
});

describe('std/error — RangeError', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { RangeError } from 'std/error';
      //@export
      function makeRangeErr() {
        const e = new RangeError('out of range');
        return e.message.length;
      }
    `);
  });
  it('RangeError.message is accessible', () => assert.equal(exp.makeRangeErr(), 12));
});

describe('std/error — multiple error types', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { AppError, ValueError, IOError, ParseError, NotFoundError } from 'std/error';
      //@export
      function allErrors() {
        const e1 = new AppError('a');
        const e2 = new ValueError('v');
        const e3 = new IOError('i');
        const e4 = new ParseError('p');
        const e5 = new NotFoundError('n');
        return e1.message.length + e2.message.length + e3.message.length
             + e4.message.length + e5.message.length;
      }
    `);
  });
  it('all five error types instantiate and expose message', () => assert.equal(exp.allErrors(), 5));
});
