/**
 * @fileoverview Pipeline orchestrator — wires parser → validator → typecheck → codegen → wabt.
 */

import { readFile } from 'fs/promises';
import initWabt from 'wabt';
import { parseSource } from './parser.js';
import { validate }    from './validator.js';
import { inferTypes }  from './typecheck.js';
import { generateWat } from './codegen.js';

/**
 * @typedef {{ wat: string, wasm: Uint8Array|null, warnings: string[] }} CompileResult
 */

// Lazy-initialised wabt singleton
/** @type {any} */
let _wabt = null;

/** @returns {Promise<any>} */
async function getWabt() {
  if (!_wabt) _wabt = await initWabt();
  return _wabt;
}

/**
 * Convert WAT text to a WASM binary via wabt.
 * @param {string} watText
 * @param {string} [filename='module.wat']
 * @returns {Promise<Uint8Array>}
 */
export async function watToWasm(watText, filename = 'module.wat') {
  const w = await getWabt();
  const mod = w.parseWat(filename, watText);
  try {
    const { buffer } = mod.toBinary({});
    return buffer;
  } finally {
    mod.destroy();
  }
}

/**
 * Disassemble a WASM binary to WAT text via wabt.
 * @param {Uint8Array|Buffer} wasmBuffer
 * @returns {Promise<string>}
 */
export async function wasmToWat(wasmBuffer) {
  const w = await getWabt();
  // wabt reads the full underlying ArrayBuffer and ignores the view's byteOffset/byteLength,
  // so Node.js Buffers (which share a pooled ArrayBuffer) must be copied into a fresh one.
  const u8 = new Uint8Array(wasmBuffer);
  const mod = w.readWasm(u8, { readDebugNames: false });
  try {
    return mod.toText({ foldExprs: false, inlineExport: true });
  } finally {
    mod.destroy();
  }
}

/**
 * Compile js.wat source text directly (without reading from disk).
 * @param {string} source  js.wat source
 * @param {string} [filename='<input>']
 * @param {{ checkOnly?: boolean }} [opts]
 * @returns {Promise<CompileResult>}
 */
export async function compileSource(source, filename = '<input>', opts = {}) {
  const { checkOnly = false } = opts;

  // 1. Parse
  const ast = parseSource(source, filename);

  // 2. Validate
  const { warnings } = validate(ast, filename);

  // 3. Type-check
  const { ast: typedAst, signatures } = inferTypes(ast, filename);

  if (checkOnly) {
    return { wat: '', wasm: null, warnings };
  }

  // 4. Code generation
  const wat = generateWat(typedAst, signatures, filename);

  // 5. Assemble
  const wasm = await watToWasm(wat, filename.replace(/\.js$/, '.wat'));

  return { wat, wasm, warnings };
}

/**
 * Main compile entry point — reads from a file path.
 *
 * @param {{ input: string, output?: string|null,
 *            checkOnly?: boolean, emitWat?: boolean }} opts
 * @returns {Promise<CompileResult>}
 */
export async function compile(opts) {
  const { input, checkOnly = false } = opts;

  const source = await readFile(input, 'utf8');
  return compileSource(source, input, { checkOnly });
}
