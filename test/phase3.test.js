/**
 * @fileoverview Phase 3 class integration tests.
 */

import { strict as assert } from 'assert';
import { readFile } from 'fs/promises';
import { compileSource } from '../src/compiler.js';

/**
 * Compile a source file and return the instantiated WASM exports.
 * @param {string} path  path relative to project root
 * @returns {Promise<WebAssembly.Exports>}
 */
async function instantiateFile(path) {
  const source = await readFile(new URL('../' + path, import.meta.url), 'utf8');
  const { wasm } = await compileSource(source, path);
  const { instance } = await WebAssembly.instantiate(wasm);
  if (instance.exports.__start) instance.exports.__start();
  return instance.exports;
}

describe('examples/class.js', () => {
  /** @type {WebAssembly.Exports} */
  let exp;
  before(async () => { exp = await instantiateFile('examples/class.js'); });

  it('main(3, 4) → 10', () => assert.equal(exp.main(3, 4), 10));
});
