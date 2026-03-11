/**
 * @fileoverview stdlib import registry and stub mapping.
 */

import { TYPES } from './types.js';

/**
 * @typedef {{ params: import('./types.js').TypeInfo[], returnType: import('./types.js').TypeInfo, stub: string }} StdFn
 */

/**
 * Namespace imports (e.g. import { console } from "std/io";).
 * @type {Record<string, Record<string, Record<string, StdFn>>>}
 */
export const STD_NAMESPACES = {
  'std/io': {
    console: {
      log:   { params: [TYPES.str], returnType: TYPES.void, stub: '__jswat_console_log' },
      error: { params: [TYPES.str], returnType: TYPES.void, stub: '__jswat_console_error' },
    },
    stdout: {
      write: { params: [TYPES.str], returnType: TYPES.void, stub: '__jswat_stdout_write' },
      writeln: { params: [TYPES.str], returnType: TYPES.void, stub: '__jswat_stdout_writeln' },
      writeString: { params: [TYPES.str], returnType: TYPES.void, stub: '__jswat_stdout_write' },
    },
    stderr: {
      write: { params: [TYPES.str], returnType: TYPES.void, stub: '__jswat_stderr_write' },
    },
    stdin: {
      read:    { params: [TYPES.usize], returnType: TYPES.str, stub: '__jswat_stdin_read' },
      readLine:{ params: [], returnType: TYPES.str, stub: '__jswat_stdin_read_line' },
      readAll: { params: [], returnType: TYPES.str, stub: '__jswat_stdin_read_all' },
    },
  },
};

/**
 * Default imports (e.g. import String from "std/string";).
 * @type {Record<string, { name: string, statics: Record<string, StdFn> }>}
 */
export const STD_DEFAULTS = {
  'std/string': {
    name: 'String',
    statics: {
      from: { params: [TYPES.isize], returnType: TYPES.str, stub: '__jswat_string_from_i32' },
    },
  },
};

/**
 * Resolve a namespace call (console.log, stdout.write, etc.).
 * @param {Map<string, { kind: 'namespace', module: string, name: string }>|null} imports
 * @param {string} objName
 * @param {string} member
 * @returns {StdFn|null}
 */
export function resolveStdNamespace(imports, objName, member) {
  if (!imports) return null;
  const info = imports.get(objName);
  if (!info || info.kind !== 'namespace') return null;
  const mod = STD_NAMESPACES[info.module];
  if (!mod) return null;
  const ns = mod[info.name];
  if (!ns) return null;
  return ns[member] ?? null;
}

/**
 * Resolve a default-import static call (e.g. String.from).
 * @param {Map<string, { kind: 'default', module: string, name: string }>|null} imports
 * @param {string} objName
 * @param {string} member
 * @returns {StdFn|null}
 */
export function resolveStdDefault(imports, objName, member) {
  if (!imports) return null;
  const info = imports.get(objName);
  if (!info || info.kind !== 'default') return null;
  const def = STD_DEFAULTS[info.module];
  if (!def) return null;
  return def.statics[member] ?? null;
}

/**
 * Collect stub function names needed by a set of imports.
 * @param {Map<string, { kind: string, module: string, name: string }>|null} imports
 * @returns {Set<string>}
 */
export function collectStdStubs(imports) {
  const stubs = new Set();
  if (!imports) return stubs;
  for (const info of imports.values()) {
    if (info.kind === 'namespace') {
      const mod = STD_NAMESPACES[info.module];
      const ns = mod?.[info.name];
      if (!ns) continue;
      for (const fn of Object.values(ns)) stubs.add(fn.stub);
    } else if (info.kind === 'default') {
      const def = STD_DEFAULTS[info.module];
      if (!def) continue;
      for (const fn of Object.values(def.statics)) stubs.add(fn.stub);
    }
  }
  return stubs;
}
