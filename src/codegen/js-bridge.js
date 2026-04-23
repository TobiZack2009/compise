/**
 * @fileoverview JS bridge assembler.
 *
 * Takes a compiled WASM binary, the @export function metadata collected by
 * module.js, and the target format (esm/cjs/bundle), and produces the bridge
 * JS source that wraps the WASM module for use from Node.js or browsers.
 */

import {
  BRIDGE_EXT_TABLE,
  BRIDGE_STRING_CODEC,
  BRIDGE_ENV_NODE,
  BRIDGE_INIT_ESM_SIDECAR,
  BRIDGE_INIT_CJS_SIDECAR,
  BRIDGE_INIT_BUNDLE,
} from './js-bridge-parts.js';

/**
 * Generate a wrapper expression for a single exported function parameter.
 * Returns `{ pre: string, argExpr: string }` where pre is any setup code
 * needed before the call (e.g. `_writeStr`), and argExpr is the WASM arg(s).
 *
 * @param {object} paramType  TypeInfo for the parameter
 * @param {string} jsArgName  JS argument name (e.g. '_a0')
 * @param {string} pairName   Name for the (ptr,len) pair local (e.g. '_p0')
 * @returns {{ pre: string, wasmArgs: string[] }}
 */
function marshalParam(paramType, jsArgName, pairName) {
  if (paramType?.kind === 'str') {
    return {
      pre: `  const ${pairName} = _writeStr(${jsArgName});\n`,
      wasmArgs: [`${pairName}[0]`, `${pairName}[1]`],
    };
  }
  // All other types pass through as-is (i32, f64, bool, etc.)
  return { pre: '', wasmArgs: [jsArgName] };
}

/**
 * Generate a wrapper expression for the return value.
 * @param {object} retType  TypeInfo
 * @returns {{ post: string, returnExpr: string }}
 *   post: code to run after the call to capture/transform the return value
 *   returnExpr: the JS value to return
 */
function marshalReturn(retType) {
  if (retType?.kind === 'str') {
    return {
      post: `  const _rLen = _ex.__str_len_out.value;\n`,
      returnExpr: '_readStr(_rPtr, _rLen)',
      resultLocal: '_rPtr',
    };
  }
  if (!retType || retType?.kind === 'void') {
    return { post: '', returnExpr: null, resultLocal: null };
  }
  return { post: '', returnExpr: '_result', resultLocal: '_result' };
}

/**
 * Generate JS wrapper source for one @export function.
 * @param {{ jsName: string, wasmName: string, params: Array, returnType: object }} fn
 * @returns {string}  JS expression like `const foo = (_a0) => { ... };`
 */
function generateWrapper(fn) {
  const { jsName, wasmName, params, returnType } = fn;

  const jsParams = [];
  const preLines = [];
  const wasmCallArgs = [];
  let pairIdx = 0;

  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    const pt = p.type;
    if (pt?.kind === 'str') {
      const jsArg = `_a${i}`;
      jsParams.push(jsArg);
      const pairName = `_sp${pairIdx++}`;
      const { pre, wasmArgs } = marshalParam(pt, jsArg, pairName);
      preLines.push(pre);
      wasmCallArgs.push(...wasmArgs);
    } else {
      const jsArg = `_a${i}`;
      jsParams.push(jsArg);
      wasmCallArgs.push(jsArg);
    }
  }

  const { post, returnExpr, resultLocal } = marshalReturn(returnType);

  const callExpr = `_ex.${wasmName}(${wasmCallArgs.join(', ')})`;

  let body = preLines.join('');
  if (resultLocal) {
    body += `  const ${resultLocal} = ${callExpr};\n`;
    body += post;
    body += `  return ${returnExpr};\n`;
  } else {
    body += `  ${callExpr};\n`;
    body += post;
  }

  return `const ${jsName} = (${jsParams.join(', ')}) => {\n${body}};\n`;
}

/**
 * Assemble the full bridge JS source for a compiled module.
 *
 * @param {Uint8Array} binary       Compiled WASM bytes
 * @param {Array}      exportList   From generateWat() — @export function metadata
 * @param {{ target: string, wasmFilename?: string }} opts
 * @returns {string}  The complete bridge JS source
 */
export function generateBridge(binary, exportList, opts = {}) {
  const { target = 'wasm32-js-esm', wasmFilename = 'module.wasm' } = opts;
  const isCjs    = target === 'wasm32-js-cjs';
  const isBundle = target === 'wasm32-js-bundle';

  // ── Wrapper functions ────────────────────────────────────────────────────
  const wrappers = exportList.map(generateWrapper);
  const exportedNames = exportList.map(fn => fn.jsName);

  // ── Assemble ──────────────────────────────────────────────────────────────
  const parts = [];

  if (isCjs) {
    // CJS: use an async IIFE assigned to module.exports
    parts.push(`'use strict';\n`);
    parts.push(`module.exports = (async () => {\n`);
    parts.push(BRIDGE_EXT_TABLE.replace(/^/gm, '  ').trimStart());
    parts.push(BRIDGE_STRING_CODEC.replace(/^/gm, '  ').trimStart());
    parts.push(BRIDGE_ENV_NODE.replace(/^/gm, '  ').trimStart());
    parts.push(BRIDGE_INIT_CJS_SIDECAR(wasmFilename).replace(/^/gm, '  ').trimStart());
    for (const w of wrappers) {
      parts.push(w.replace(/^/gm, '  ').trimStart());
    }
    if (exportedNames.length > 0) {
      parts.push(`  return { ${exportedNames.join(', ')} };\n`);
    } else {
      parts.push(`  return {};\n`);
    }
    parts.push(`})();\n`);
  } else {
    // ESM or bundle: top-level await
    parts.push(BRIDGE_EXT_TABLE);
    parts.push(BRIDGE_STRING_CODEC);
    parts.push(BRIDGE_ENV_NODE);

    if (isBundle) {
      // Cross-platform base64 encoding: Node.js Buffer or browser btoa
      const base64 = typeof Buffer !== 'undefined'
        ? Buffer.from(binary).toString('base64')
        : btoa(Array.from(binary, b => String.fromCharCode(b)).join(''));
      parts.push(BRIDGE_INIT_BUNDLE(base64));
    } else {
      parts.push(BRIDGE_INIT_ESM_SIDECAR(wasmFilename));
    }

    for (const w of wrappers) parts.push(w);

    if (exportedNames.length > 0) {
      parts.push(`export { ${exportedNames.join(', ')} };\n`);
    }
  }

  return parts.join('');
}
