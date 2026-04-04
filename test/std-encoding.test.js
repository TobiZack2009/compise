/**
 * @fileoverview std/encoding tests — Base64 and UTF8 utilities.
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

// Decode a str fat pointer from WASM memory.
// ptr = raw bytes address; len comes from the __str_len_out exported global.
function readStr(exports, ptr) {
  if (!ptr) return '';
  const len = exports.__str_len_out.value;
  if (!len) return '';
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

describe('std/encoding — Base64 encode', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { Base64 } from 'std/encoding';
      //@export
      function encodeHello() { return Base64.encode('hello'); }
      //@export
      function encodeEmpty() { return Base64.encode(''); }
      //@export
      function encodeABC()   { return Base64.encode('abc'); }
    `);
  });

  it('Base64.encode("hello") → "aGVsbG8="', () => {
    assert.equal(readStr(exp, exp.encodeHello()), 'aGVsbG8=');
  });
  it('Base64.encode("") → ""', () => {
    assert.equal(readStr(exp, exp.encodeEmpty()), '');
  });
  it('Base64.encode("abc") → "YWJj"', () => {
    assert.equal(readStr(exp, exp.encodeABC()), 'YWJj');
  });
});

describe('std/encoding — Base64 decode', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { Base64 } from 'std/encoding';
      //@export
      function decodeHello() { return Base64.decode('aGVsbG8='); }
      //@export
      function decodeABC()   { return Base64.decode('YWJj'); }
    `);
  });

  it('Base64.decode("aGVsbG8=") → "hello"', () => {
    assert.equal(readStr(exp, exp.decodeHello()), 'hello');
  });
  it('Base64.decode("YWJj") → "abc"', () => {
    assert.equal(readStr(exp, exp.decodeABC()), 'abc');
  });
});

describe('std/encoding — UTF8', () => {
  let exp;
  before(async () => {
    exp = await instantiate(`
      import { UTF8 } from 'std/encoding';
      //@export
      function validateAscii()  { return UTF8.validate('hello') ? 1 : 0; }
      //@export
      function validateEmpty()  { return UTF8.validate('') ? 1 : 0; }
      //@export
      function charCountAscii() { return UTF8.charCount('hello'); }
      //@export
      function charCountEmpty() { return UTF8.charCount(''); }
    `);
  });

  it('UTF8.validate("hello") → true', () => assert.equal(exp.validateAscii(), 1));
  it('UTF8.validate("") → true',      () => assert.equal(exp.validateEmpty(), 1));
  it('UTF8.charCount("hello") → 5',   () => assert.equal(exp.charCountAscii(), 5));
  it('UTF8.charCount("") → 0',        () => assert.equal(exp.charCountEmpty(), 0));
});
