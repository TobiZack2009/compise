/**
 * @fileoverview Pipeline orchestrator — wires parser → validator → typecheck → codegen → wabt.
 * Zero Node.js-specific imports; safe to bundle for the browser.
 */

import initWabt from 'wabt';
import { parseSource } from './parser.js';
import { validate }    from './validator.js';
import { inferTypes }  from './typecheck.js';
import { generateWat } from './codegen/index.js';
import { ModuleResolver } from './resolver.js';

/**
 * @typedef {{ wat: string, wasm: Uint8Array|null, warnings: string[], layoutMap?: object }} CompileResult
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
 * @param {{ checkOnly?: boolean, readFile?: ((path: string) => string) | null, stdRoot?: string | null, target?: string, lib?: boolean }} [opts]
 * @returns {Promise<CompileResult>}
 */
export async function compileSource(source, filename = '<input>', opts = {}) {
  const { checkOnly = false, readFile = null, stdRoot = null, target = 'wasm32-wasip1', lib = false } = opts;

  // 1. Parse
  const ast = parseSource(source, filename);

  // 2. Validate
  const { warnings } = validate(ast, filename);

  // 3. Resolve transitive stdlib/user imports (when readFile+stdRoot are provided)
  /** @type {Array<{ ast: object, filename: string }>} */
  let stdModules = [];
  if (readFile && stdRoot) {
    const resolver = new ModuleResolver(stdRoot, readFile, parseSource);
    const deps = resolver.collectDeps(ast, filename);
    stdModules = deps.map(({ source: s, filename: f }) => ({
      ast: parseSource(s, f),
      filename: f,
    }));
  }

  // 4. Type-check
  const { ast: typedAst, signatures, classes, imports } =
    inferTypes(ast, filename, { stdModules });

  if (checkOnly) {
    return { wat: '', wasm: null, warnings };
  }

  // 5. Code generation + assemble (binaryen emits binary directly)
  const { wat, binary: wasm, layoutMap } =
    generateWat(typedAst, signatures, classes, imports, filename, { stdModules, target, lib });

  return { wat, wasm, warnings, layoutMap };
}

