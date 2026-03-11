/**
 * @fileoverview Pure WAT text builder helpers.
 * No project dependencies — only string operations.
 */

/**
 * Indent every line of text (or each element of a string array) by n spaces.
 * @param {string|string[]} text
 * @param {number} [n=2]
 * @returns {string|string[]}
 */
export function indent(text, n = 2) {
  const pad = ' '.repeat(n);
  if (Array.isArray(text)) return text.map(l => pad + l);
  return text.split('\n').map(l => (l ? pad + l : l)).join('\n');
}

/**
 * `(param $name wasmType)`
 * @param {string} name
 * @param {string} wasmType
 * @returns {string}
 */
export function param(name, wasmType) {
  return `(param $${name} ${wasmType})`;
}

/**
 * `(result wasmType)` — returns empty string for void.
 * @param {string} wasmType
 * @returns {string}
 */
export function result(wasmType) {
  if (!wasmType) return '';
  return `(result ${wasmType})`;
}

/**
 * `(local $name wasmType)`
 * @param {string} name
 * @param {string} wasmType
 * @returns {string}
 */
export function local(name, wasmType) {
  return `(local $${name} ${wasmType})`;
}

/** @param {string} name @returns {string} */
export function localGet(name) { return `local.get $${name}`; }

/** @param {string} name @returns {string} */
export function localSet(name) { return `local.set $${name}`; }

/** @param {string} name @returns {string} */
export function localTee(name) { return `local.tee $${name}`; }

/** @param {number|string} value @returns {string} */
export function i32Const(value) { return `i32.const ${value}`; }

/** @param {number|string} value @returns {string} */
export function i64Const(value) { return `i64.const ${value}`; }

/** @param {number|string} value @returns {string} */
export function f32Const(value) { return `f32.const ${value}`; }

/** @param {number|string} value @returns {string} */
export function f64Const(value) { return `f64.const ${value}`; }

/**
 * Return the WAT instruction string for a binary operator.
 * @param {string} wasmOp  e.g. 'i32.add'
 * @returns {string}
 */
export function binOp(wasmOp) { return wasmOp; }

/**
 * Build an `if ... else ... end` instruction block (unfolded WAT form).
 * The condition instructions must leave an i32 on the stack.
 * @param {{ condition?: string[], then?: string[], else_?: string[], resultType?: string }} opts
 * @returns {string[]}
 */
export function ifBlock({ condition = [], then: thenInstrs = [], else_: elseInstrs, resultType: resType }) {
  const lines = [];
  for (const c of condition) lines.push(c);
  lines.push(resType ? `if (result ${resType})` : 'if');
  for (const i of thenInstrs) lines.push('  ' + i);
  if (elseInstrs && elseInstrs.length > 0) {
    lines.push('else');
    for (const i of elseInstrs) lines.push('  ' + i);
  }
  lines.push('end');
  return lines;
}

/**
 * `(export "exportName" (func $internalName))`
 * @param {string} exportName
 * @param {string} internalName
 * @returns {string}
 */
export function exportFunc(exportName, internalName) {
  return `(export "${exportName}" (func $${internalName}))`;
}

/**
 * `(memory (export "memory") pages)`
 * @param {number} [pages=1]
 * @returns {string}
 */
export function memoryExport(pages = 1) {
  return `(memory (export "memory") ${pages})`;
}

/**
 * Build a complete `(func ...)` S-expression string.
 * @param {{ name: string, params?: string[], result?: string, locals?: string[],
 *            body?: (string|string[])[], export?: string }} opts
 * @returns {string}
 */
export function buildFunction({ name, params: funcParams = [], result: funcResult = '',
                                 locals: funcLocals = [], body = [], export: exportName }) {
  const header = [
    `(func $${name}`,
    ...(exportName ? [`(export "${exportName}")`] : []),
    ...funcParams,
    ...(funcResult ? [`(result ${funcResult})`] : []),
  ].join(' ');

  const lines = [header];
  for (const l of funcLocals)  lines.push('  ' + l);
  for (const instr of body) {
    if (Array.isArray(instr)) {
      for (const i of instr) lines.push('  ' + i);
    } else {
      lines.push('  ' + instr);
    }
  }
  lines.push(')');
  return lines.join('\n');
}

/**
 * Build a complete `(module ...)` S-expression string.
 * @param {{ memories?: string[], functions?: string[], exports?: string[],
 *            imports?: string[], globals?: string[] }} opts
 * @returns {string}
 */
export function buildModule({ memories = [], functions = [], exports: modExports = [],
                               imports: modImports = [], globals = [], data = [] } = {}) {
  const lines = ['(module'];
  for (const imp of modImports) lines.push('  ' + imp);
  for (const m of memories)    lines.push('  ' + m);
  for (const g of globals)     lines.push('  ' + g);
  for (const d of data)        lines.push('  ' + d);
  for (const fn of functions) {
    for (const l of fn.split('\n')) lines.push('  ' + l);
  }
  for (const exp of modExports) lines.push('  ' + exp);
  lines.push(')');
  return lines.join('\n');
}
