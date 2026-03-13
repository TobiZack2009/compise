/**
 * @fileoverview Drop-in replacement for src/codegen.js — re-exports the public API.
 */

export { generateWat } from './module.js';
export { CodegenError } from './context.js';
export { collectLocals } from './expressions.js';
