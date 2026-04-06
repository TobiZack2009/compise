/**
 * @fileoverview Compile error types and helpers for js.wat.
 * All compile-time errors should be instances of CompileError with a CE- code.
 */

export class CompileError extends Error {
  /**
   * @param {string} code  CE- error code (e.g. 'CE-V02')
   * @param {string} msg   Human-readable message
   * @param {{ filename?: string, line?: number|null, col?: number|null }} [loc]
   */
  constructor(code, msg, { filename, line, col } = {}) {
    const loc = filename
      ? ` (${filename}:${line ?? '?'}:${col ?? '?'})`
      : '';
    super(`${code}: ${msg}${loc}`);
    this.name = 'CompileError';
    this.code = code;
    this.filename = filename ?? null;
    this.line = line ?? null;
    this.col  = col  ?? null;
  }
}

/**
 * Build a CompileError from an AST node's location (acorn node.loc).
 * Acorn columns are 0-indexed; this converts to 1-indexed for display.
 *
 * @param {string} code      CE- error code
 * @param {string} msg       Human-readable message
 * @param {object|null} node acorn AST node (may be null)
 * @param {string} [filename]
 * @returns {CompileError}
 */
export function ceErr(code, msg, node, filename) {
  return new CompileError(code, msg, {
    filename,
    line: node?.loc?.start?.line ?? null,
    col:  node?.loc?.start?.column != null ? node.loc.start.column + 1 : null,
  });
}
