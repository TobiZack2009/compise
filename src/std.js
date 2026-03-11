/**
 * @fileoverview stdlib import registry and stub mapping.
 */

import { TYPES } from './types.js';

/**
 * @typedef {{ params: import('./types.js').TypeInfo[], returnType: import('./types.js').TypeInfo, stub?: string, intrinsic?: string }} StdFn
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
  'std/fs': {
    FS: {
      read:   { params: [TYPES.str], returnType: TYPES.str, stub: '__jswat_fs_read' },
      write:  { params: [TYPES.str, TYPES.str], returnType: TYPES.bool, stub: '__jswat_fs_write' },
      append: { params: [TYPES.str, TYPES.str], returnType: TYPES.bool, stub: '__jswat_fs_append' },
      exists: { params: [TYPES.str], returnType: TYPES.bool, stub: '__jswat_fs_exists' },
      delete: { params: [TYPES.str], returnType: TYPES.bool, stub: '__jswat_fs_delete' },
      mkdir:  { params: [TYPES.str], returnType: TYPES.bool, stub: '__jswat_fs_mkdir' },
      readdir:{ params: [TYPES.str], returnType: TYPES.str, stub: '__jswat_fs_readdir' },
    },
  },
  'std/clock': {
    Clock: {
      now: { params: [], returnType: TYPES.isize, stub: '__jswat_clock_now' },
      monotonic: { params: [], returnType: TYPES.isize, stub: '__jswat_clock_monotonic' },
      sleep: { params: [TYPES.isize], returnType: TYPES.void, stub: '__jswat_clock_sleep' },
    },
  },
  'std/collections': {
    Map: {
      set: { params: [TYPES.Map, TYPES.str, TYPES.isize], returnType: TYPES.void, stub: '__jswat_map_set' },
      get: { params: [TYPES.Map, TYPES.str], returnType: TYPES.isize, stub: '__jswat_map_get' },
      has: { params: [TYPES.Map, TYPES.str], returnType: TYPES.bool, stub: '__jswat_map_has' },
      delete: { params: [TYPES.Map, TYPES.str], returnType: TYPES.bool, stub: '__jswat_map_delete' },
      size: { params: [TYPES.Map], returnType: TYPES.usize, stub: '__jswat_map_size' },
    },
    Set: {
      add: { params: [TYPES.Set, TYPES.isize], returnType: TYPES.void, stub: '__jswat_set_add' },
      has: { params: [TYPES.Set, TYPES.isize], returnType: TYPES.bool, stub: '__jswat_set_has' },
      delete: { params: [TYPES.Set, TYPES.isize], returnType: TYPES.bool, stub: '__jswat_set_delete' },
      size: { params: [TYPES.Set], returnType: TYPES.usize, stub: '__jswat_set_size' },
    },
    Queue: {
      push: { params: [TYPES.Queue, TYPES.isize], returnType: TYPES.void, stub: '__jswat_queue_push' },
      pop: { params: [TYPES.Queue], returnType: TYPES.isize, stub: '__jswat_queue_pop' },
      size: { params: [TYPES.Queue], returnType: TYPES.usize, stub: '__jswat_queue_size' },
    },
    Stack: {
      push: { params: [TYPES.Stack, TYPES.isize], returnType: TYPES.void, stub: '__jswat_stack_push' },
      pop: { params: [TYPES.Stack], returnType: TYPES.isize, stub: '__jswat_stack_pop' },
      size: { params: [TYPES.Stack], returnType: TYPES.usize, stub: '__jswat_stack_size' },
    },
    Deque: {
      pushFront: { params: [TYPES.Deque, TYPES.isize], returnType: TYPES.void, stub: '__jswat_deque_push_front' },
      pushBack: { params: [TYPES.Deque, TYPES.isize], returnType: TYPES.void, stub: '__jswat_deque_push_back' },
      popFront: { params: [TYPES.Deque], returnType: TYPES.isize, stub: '__jswat_deque_pop_front' },
      popBack: { params: [TYPES.Deque], returnType: TYPES.isize, stub: '__jswat_deque_pop_back' },
      size: { params: [TYPES.Deque], returnType: TYPES.usize, stub: '__jswat_deque_size' },
    },
  },
  'std/mem': {
    alloc: {
      bytes: { params: [TYPES.usize, TYPES.u8], returnType: TYPES.usize, stub: '__jswat_alloc_bytes' },
      realloc: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.usize, stub: '__jswat_alloc_realloc' },
      copy: { params: [TYPES.usize, TYPES.usize, TYPES.usize], returnType: TYPES.void, stub: '__jswat_alloc_copy' },
      fill: { params: [TYPES.usize, TYPES.u8, TYPES.usize], returnType: TYPES.void, stub: '__jswat_alloc_fill' },
    },
    ptr: {
      fromAddr: { params: [TYPES.usize], returnType: TYPES.usize, stub: '__jswat_ptr_from_addr' },
      diff: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.isize, stub: '__jswat_ptr_diff' },
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
  'std/random': {
    name: 'Random',
    statics: {
      float: { params: [], returnType: TYPES.f64, stub: '__jswat_random_float' },
      seed: { params: [TYPES.isize], returnType: TYPES.void, stub: '__jswat_random_seed' },
    },
  },
};

/**
 * Direct function imports (e.g. import { i32_clz } from "std/wasm";).
 * @type {Record<string, Record<string, StdFn>>}
 */
export const STD_FUNCTIONS = {
  'std/wasm': {
    i32_clz: { params: [TYPES.i32], returnType: TYPES.i32, intrinsic: 'i32.clz' },
    i32_ctz: { params: [TYPES.i32], returnType: TYPES.i32, intrinsic: 'i32.ctz' },
    i32_popcnt: { params: [TYPES.i32], returnType: TYPES.i32, intrinsic: 'i32.popcnt' },
    i32_rotl: { params: [TYPES.i32, TYPES.i32], returnType: TYPES.i32, intrinsic: 'i32.rotl' },
    i32_rotr: { params: [TYPES.i32, TYPES.i32], returnType: TYPES.i32, intrinsic: 'i32.rotr' },

    i64_clz: { params: [TYPES.i64], returnType: TYPES.i64, intrinsic: 'i64.clz' },
    i64_ctz: { params: [TYPES.i64], returnType: TYPES.i64, intrinsic: 'i64.ctz' },
    i64_popcnt: { params: [TYPES.i64], returnType: TYPES.i64, intrinsic: 'i64.popcnt' },
    i64_rotl: { params: [TYPES.i64, TYPES.i64], returnType: TYPES.i64, intrinsic: 'i64.rotl' },
    i64_rotr: { params: [TYPES.i64, TYPES.i64], returnType: TYPES.i64, intrinsic: 'i64.rotr' },

    f32_sqrt: { params: [TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.sqrt' },
    f32_floor: { params: [TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.floor' },
    f32_ceil: { params: [TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.ceil' },
    f32_trunc: { params: [TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.trunc' },
    f32_nearest: { params: [TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.nearest' },
    f32_abs: { params: [TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.abs' },
    f32_min: { params: [TYPES.f32, TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.min' },
    f32_max: { params: [TYPES.f32, TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.max' },
    f32_copysign: { params: [TYPES.f32, TYPES.f32], returnType: TYPES.f32, intrinsic: 'f32.copysign' },

    f64_sqrt: { params: [TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.sqrt' },
    f64_floor: { params: [TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.floor' },
    f64_ceil: { params: [TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.ceil' },
    f64_trunc: { params: [TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.trunc' },
    f64_nearest: { params: [TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.nearest' },
    f64_abs: { params: [TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.abs' },
    f64_min: { params: [TYPES.f64, TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.min' },
    f64_max: { params: [TYPES.f64, TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.max' },
    f64_copysign: { params: [TYPES.f64, TYPES.f64], returnType: TYPES.f64, intrinsic: 'f64.copysign' },

    i32_reinterpret_f32: { params: [TYPES.f32], returnType: TYPES.i32, intrinsic: 'i32.reinterpret_f32' },
    f32_reinterpret_i32: { params: [TYPES.i32], returnType: TYPES.f32, intrinsic: 'f32.reinterpret_i32' },
    i64_reinterpret_f64: { params: [TYPES.f64], returnType: TYPES.i64, intrinsic: 'i64.reinterpret_f64' },
    f64_reinterpret_i64: { params: [TYPES.i64], returnType: TYPES.f64, intrinsic: 'f64.reinterpret_i64' },

    i32_load: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.i32, intrinsic: 'i32.load' },
    i32_store: { params: [TYPES.usize, TYPES.usize, TYPES.i32], returnType: TYPES.void, intrinsic: 'i32.store' },
    i32_load8_s: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.i32, intrinsic: 'i32.load8_s' },
    i32_load8_u: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.i32, intrinsic: 'i32.load8_u' },
    i32_store8: { params: [TYPES.usize, TYPES.usize, TYPES.i32], returnType: TYPES.void, intrinsic: 'i32.store8' },
    i32_load16_s: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.i32, intrinsic: 'i32.load16_s' },
    i32_load16_u: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.i32, intrinsic: 'i32.load16_u' },
    i32_store16: { params: [TYPES.usize, TYPES.usize, TYPES.i32], returnType: TYPES.void, intrinsic: 'i32.store16' },
    i64_load: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.i64, intrinsic: 'i64.load' },
    i64_store: { params: [TYPES.usize, TYPES.usize, TYPES.i64], returnType: TYPES.void, intrinsic: 'i64.store' },
    f32_load: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.f32, intrinsic: 'f32.load' },
    f32_store: { params: [TYPES.usize, TYPES.usize, TYPES.f32], returnType: TYPES.void, intrinsic: 'f32.store' },
    f64_load: { params: [TYPES.usize, TYPES.usize], returnType: TYPES.f64, intrinsic: 'f64.load' },
    f64_store: { params: [TYPES.usize, TYPES.usize, TYPES.f64], returnType: TYPES.void, intrinsic: 'f64.store' },
    memory_size: { params: [], returnType: TYPES.usize, intrinsic: 'memory.size' },
    memory_grow: { params: [TYPES.usize], returnType: TYPES.usize, intrinsic: 'memory.grow' },
    memory_copy: { params: [TYPES.usize, TYPES.usize, TYPES.usize], returnType: TYPES.void, intrinsic: 'memory.copy' },
    memory_fill: { params: [TYPES.usize, TYPES.i32, TYPES.usize], returnType: TYPES.void, intrinsic: 'memory.fill' },
  },
};

/**
 * Resolve std/collections instance methods by collection name.
 * @param {string} collectionName
 * @param {string} method
 * @returns {StdFn|null}
 */
export function resolveStdCollectionMethod(collectionName, method) {
  const col = STD_NAMESPACES['std/collections']?.[collectionName];
  if (!col) return null;
  return col[method] ?? null;
}

/**
 * Resolve std/collections constructors.
 * @param {string} collectionName
 * @returns {string|null}
 */
export function resolveStdCollectionCtor(collectionName) {
  const map = {
    Map: '__jswat_map_new',
    Set: '__jswat_set_new',
    Queue: '__jswat_queue_new',
    Stack: '__jswat_stack_new',
    Deque: '__jswat_deque_new',
  };
  return map[collectionName] ?? null;
}

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
 * Resolve a direct function import (e.g. i32_clz).
 * @param {Map<string, { kind: string, module: string, name: string }>|null} imports
 * @param {string} name
 * @returns {StdFn|null}
 */
export function resolveStdFunction(imports, name) {
  if (!imports) return null;
  const info = imports.get(name);
  if (!info || info.kind !== 'namespace') return null;
  const mod = STD_FUNCTIONS[info.module];
  if (!mod) return null;
  return mod[info.name] ?? null;
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
      if (ns) {
        for (const fn of Object.values(ns)) if (fn.stub) stubs.add(fn.stub);
      }
      const direct = STD_FUNCTIONS[info.module]?.[info.name];
      if (direct?.stub) stubs.add(direct.stub);
    } else if (info.kind === 'default') {
      const def = STD_DEFAULTS[info.module];
      if (!def) continue;
      for (const fn of Object.values(def.statics)) if (fn.stub) stubs.add(fn.stub);
    }
  }
  return stubs;
}
