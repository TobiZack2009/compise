/**
 * @fileoverview Public library API for js.wat compiler — browser-safe, zero Node.js dependencies.
 *
 * Usage (library consumer):
 *   import { compile } from 'jswat/src/index.js';
 *   const { wat, wasm } = await compile(source, '<input>', { readFile, stdRoot });
 */

export { compile, compileSource, watToWasm, wasmToWat } from './compiler.js';
export { parseSource } from './parser.js';
export { validate } from './validator.js';
