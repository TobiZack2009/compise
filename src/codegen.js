/**
 * @fileoverview Typed AST → WAT text generator.
 * Requires `inferTypes` to have already annotated the AST with `_type` properties.
 */

import { TYPES, toWatType } from './types.js';
import { buildModule, buildFunction, memoryExport, param, local, result,
         localGet, localSet, localTee, i32Const, i64Const, f32Const, f64Const } from './wat.js';
import { buildAllocator } from './allocator.js';
import { collectStdStubs, resolveStdNamespace, resolveStdDefault, resolveStdCollectionMethod, resolveStdCollectionCtor, resolveStdFunction } from './std.js';

/**
 * @typedef {import('./types.js').TypeInfo} TypeInfo
 * @typedef {import('./typecheck.js').FunctionSignature} FunctionSignature
 */

export class CodegenError extends Error {
  /** @param {string} msg */
  constructor(msg) { super(msg); this.name = 'CodegenError'; }
}

// ── Codegen context ─────────────────────────────────────────────────────────

class GenContext {
  /**
   * @param {Map<string, import('./typecheck.js').ClassInfo>|null} classes
   * @param {Map<string, { size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>} layouts
   * @param {Map<string, { kind: string, module: string, name: string }>|null} imports
   */
  constructor(classes, layouts, imports) {
    this._label = 0;
    /** @type {Array<{ breakLabel: string, continueLabel: string }>} */
    this._loopStack = [];
    this._classes = classes;
    this._layouts = layouts;
    this._imports = imports;
  }

  /** @param {string} prefix @returns {string} */
  nextLabel(prefix) {
    const label = `${prefix}_${this._label}`;
    this._label += 1;
    return label;
  }

  /** @param {string} breakLabel @param {string} continueLabel */
  pushLoop(breakLabel, continueLabel) {
    this._loopStack.push({ breakLabel, continueLabel });
  }

  popLoop() { this._loopStack.pop(); }

  /** @returns {{ breakLabel: string, continueLabel: string }|undefined} */
  currentLoop() { return this._loopStack[this._loopStack.length - 1]; }
}

/**
 * Build string data segments and address map.
 * Layout: [len:4][hash:4][bytes...]
 * @param {object} ast
 * @returns {{ map: Map<string, number>, data: string[] }}
 */
function buildStringTable(ast) {
  const encoder = new TextEncoder();
  const strings = new Map();
  let offset = 0;

  /** @param {object} node */
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      if (!strings.has(node.value)) {
        const bytes = encoder.encode(node.value);
        const len = bytes.length;
        const total = 8 + len;
        strings.set(node.value, { offset, bytes, len });
        offset += total;
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof item.type === 'string') visit(item);
        }
      } else if (child && typeof child === 'object' && typeof child.type === 'string') {
        visit(child);
      }
    }
  }

  visit(ast);

  const data = [];
  const map = new Map();
  for (const [value, info] of strings.entries()) {
    map.set(value, info.offset);
    const bytes = new Uint8Array(8 + info.len);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, info.len, true);
    dv.setUint32(4, 0, true);
    bytes.set(info.bytes, 8);
    data.push(`(data (i32.const ${info.offset}) "${bytesToWatString(bytes)}")`);
  }
  return { map, data, size: offset };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToWatString(bytes) {
  let out = '';
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c) {
      out += String.fromCharCode(b);
    } else {
      out += '\\' + b.toString(16).padStart(2, '0');
    }
  }
  return out;
}

/**
 * Build no-op stdlib stubs so calls resolve even without WASI.
 * @param {string} name
 * @returns {string}
 */
function buildStdStub(name) {
  const hasArg = name.includes('write') || name.includes('log') || name.includes('error');
  const returnsPtr = name.includes('read') || name.includes('from');
  return buildFunction({
    name,
    params: hasArg ? [param('arg0', 'i32')] : [],
    result: returnsPtr ? 'i32' : '',
    body: returnsPtr ? [i32Const(0)] : [],
  });
}

/**
 * Build std/mem helper functions.
 * @returns {string[]}
 */
function buildMemFunctions() {
  const allocCopy = buildFunction({
    name: '__jswat_alloc_copy',
    params: [param('dst', 'i32'), param('src', 'i32'), param('n', 'i32')],
    result: '',
    body: [
      'local.get $dst',
      'local.get $src',
      'local.get $n',
      'memory.copy',
    ],
  });

  const allocFill = buildFunction({
    name: '__jswat_alloc_fill',
    params: [param('dst', 'i32'), param('value', 'i32'), param('n', 'i32')],
    result: '',
    body: [
      'local.get $dst',
      'local.get $value',
      'local.get $n',
      'memory.fill',
    ],
  });

  const allocRealloc = buildFunction({
    name: '__jswat_alloc_realloc',
    params: [param('ptr', 'i32'), param('newSize', 'i32')],
    result: 'i32',
    locals: [local('newPtr', 'i32')],
    body: [
      'local.get $newSize',
      i32Const(0),
      'call $__jswat_alloc_bytes',
      'local.set $newPtr',
      'local.get $newPtr',
      'local.get $ptr',
      'local.get $newSize',
      'memory.copy',
      'local.get $newPtr',
    ],
  });

  const ptrFromAddr = buildFunction({
    name: '__jswat_ptr_from_addr',
    params: [param('addr', 'i32')],
    result: 'i32',
    body: ['local.get $addr'],
  });

  const ptrDiff = buildFunction({
    name: '__jswat_ptr_diff',
    params: [param('a', 'i32'), param('b', 'i32')],
    result: 'i32',
    body: [
      'local.get $a',
      'local.get $b',
      'i32.sub',
    ],
  });

  return [allocCopy, allocFill, allocRealloc, ptrFromAddr, ptrDiff];
}

/**
 * Build WASI fd_write import when std/io is used.
 * @returns {string[]}
 */
function buildWasiImports(hasIo, hasFs, hasClock, hasRandom) {
  const imports = [];
  if (hasIo || hasFs) {
    imports.push('(import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))');
    imports.push('(import "wasi_snapshot_preview1" "fd_read" (func $fd_read (param i32 i32 i32 i32) (result i32)))');
  }
  if (hasFs) {
    imports.push('(import "wasi_snapshot_preview1" "fd_close" (func $fd_close (param i32) (result i32)))');
    imports.push('(import "wasi_snapshot_preview1" "path_open" (func $path_open (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32)))');
    imports.push('(import "wasi_snapshot_preview1" "path_filestat_get" (func $path_filestat_get (param i32 i32 i32 i32 i32) (result i32)))');
    imports.push('(import "wasi_snapshot_preview1" "path_create_directory" (func $path_create_directory (param i32 i32 i32) (result i32)))');
    imports.push('(import "wasi_snapshot_preview1" "path_unlink_file" (func $path_unlink_file (param i32 i32 i32) (result i32)))');
  }
  if (hasClock) {
    imports.push('(import "wasi_snapshot_preview1" "clock_time_get" (func $clock_time_get (param i32 i64 i32) (result i32)))');
  }
  if (hasRandom) {
    imports.push('(import "wasi_snapshot_preview1" "random_get" (func $random_get (param i32 i32) (result i32)))');
  }
  return imports;
}

/**
 * Build std/io implementations backed by fd_write.
 * @param {number} ioBase
 * @returns {string[]}
 */
function buildIoFunctions(ioBase) {
  const writeFn = buildFunction({
    name: '__jswat_write',
    params: [param('fd', 'i32'), param('str', 'i32')],
    result: '',
    locals: [local('len', 'i32'), local('ptr', 'i32')],
    body: [
      'local.get $str',
      'i32.load',
      'local.set $len',
      'local.get $str',
      i32Const(8),
      'i32.add',
      'local.set $ptr',
      i32Const(ioBase),
      'local.get $ptr',
      'i32.store',
      i32Const(ioBase + 4),
      'local.get $len',
      'i32.store',
      'local.get $fd',
      i32Const(ioBase),
      i32Const(1),
      i32Const(ioBase + 8),
      'call $fd_write',
      'drop',
    ],
  });

  const writeLineFn = buildFunction({
    name: '__jswat_write_line',
    params: [param('fd', 'i32'), param('str', 'i32')],
    result: '',
    locals: [local('len', 'i32'), local('ptr', 'i32')],
    body: [
      'local.get $str',
      'i32.load',
      'local.set $len',
      'local.get $str',
      i32Const(8),
      'i32.add',
      'local.set $ptr',
      i32Const(ioBase),
      'local.get $ptr',
      'i32.store',
      i32Const(ioBase + 4),
      'local.get $len',
      'i32.store',
      i32Const(ioBase + 8),
      i32Const(ioBase + 32),
      'i32.store',
      i32Const(ioBase + 12),
      i32Const(1),
      'i32.store',
      i32Const(ioBase + 32),
      i32Const(10),
      'i32.store8',
      'local.get $fd',
      i32Const(ioBase),
      i32Const(2),
      i32Const(ioBase + 16),
      'call $fd_write',
      'drop',
    ],
  });

  const logFn = buildFunction({
    name: '__jswat_console_log',
    params: [param('arg0', 'i32')],
    result: '',
    body: ['i32.const 1', 'local.get $arg0', 'call $__jswat_write_line'],
  });

  const errFn = buildFunction({
    name: '__jswat_console_error',
    params: [param('arg0', 'i32')],
    result: '',
    body: ['i32.const 2', 'local.get $arg0', 'call $__jswat_write_line'],
  });

  const stdoutFn = buildFunction({
    name: '__jswat_stdout_write',
    params: [param('arg0', 'i32')],
    result: '',
    body: ['i32.const 1', 'local.get $arg0', 'call $__jswat_write'],
  });

  const stdoutWritelnFn = buildFunction({
    name: '__jswat_stdout_writeln',
    params: [param('arg0', 'i32')],
    result: '',
    body: ['i32.const 1', 'local.get $arg0', 'call $__jswat_write_line'],
  });

  const stderrFn = buildFunction({
    name: '__jswat_stderr_write',
    params: [param('arg0', 'i32')],
    result: '',
    body: ['i32.const 2', 'local.get $arg0', 'call $__jswat_write'],
  });

  const stdinRead = buildFunction({
    name: '__jswat_stdin_read',
    params: [param('size', 'i32')],
    result: 'i32',
    locals: [local('buf', 'i32'), local('nread', 'i32'), local('str', 'i32')],
    body: [
      'local.get $size',
      i32Const(0),
      'call $__jswat_alloc_bytes',
      'local.set $buf',
      i32Const(ioBase + 16),
      'local.get $buf',
      'i32.store',
      i32Const(ioBase + 20),
      'local.get $size',
      'i32.store',
      i32Const(0),
      i32Const(ioBase + 16),
      i32Const(1),
      i32Const(ioBase + 24),
      'call $fd_read',
      'drop',
      i32Const(ioBase + 24),
      'i32.load',
      'local.set $nread',
      'local.get $nread',
      'i32.eqz',
      'if',
      i32Const(0),
      '  return',
      'end',
      'local.get $nread',
      i32Const(8),
      'i32.add',
      'call $__jswat_alloc',
      'local.set $str',
      'local.get $str',
      'local.get $nread',
      'i32.store',
      'local.get $str',
      i32Const(4),
      'i32.add',
      i32Const(0),
      'i32.store',
      'local.get $str',
      i32Const(8),
      'i32.add',
      'local.get $buf',
      'local.get $nread',
      'memory.copy',
      'local.get $str',
    ],
  });

  const stdinReadAll = buildFunction({
    name: '__jswat_stdin_read_all',
    params: [],
    result: 'i32',
    locals: [
      local('buf', 'i32'),
      local('cap', 'i32'),
      local('total', 'i32'),
      local('nread', 'i32'),
      local('newCap', 'i32'),
      local('str', 'i32'),
    ],
    body: [
      i32Const(1024),
      'local.set $cap',
      i32Const(1024),
      i32Const(0),
      'call $__jswat_alloc_bytes',
      'local.set $buf',
      i32Const(0),
      'local.set $total',
      'block $done',
      '  loop $read',
      '    local.get $total',
      '    local.get $cap',
      '    i32.eq',
      '    if',
      '      local.get $cap',
      i32Const(2),
      '      i32.mul',
      '      local.set $newCap',
      '      local.get $buf',
      '      local.get $cap',
      '      local.get $newCap',
      '      call $__jswat_realloc',
      '      local.set $buf',
      '      local.get $newCap',
      '      local.set $cap',
      '    end',
      i32Const(ioBase + 16),
      '    local.get $buf',
      '    local.get $total',
      '    i32.add',
      '    i32.store',
      i32Const(ioBase + 20),
      '    local.get $cap',
      '    local.get $total',
      '    i32.sub',
      '    i32.store',
      i32Const(0),
      i32Const(ioBase + 16),
      i32Const(1),
      i32Const(ioBase + 24),
      '    call $fd_read',
      '    drop',
      i32Const(ioBase + 24),
      '    i32.load',
      '    local.set $nread',
      '    local.get $nread',
      '    i32.eqz',
      '    br_if $done',
      '    local.get $total',
      '    local.get $nread',
      '    i32.add',
      '    local.set $total',
      '    br $read',
      '  end',
      'end',
      'local.get $total',
      'i32.eqz',
      'if',
      i32Const(0),
      '  return',
      'end',
      'local.get $total',
      i32Const(8),
      'i32.add',
      'call $__jswat_alloc',
      'local.set $str',
      'local.get $str',
      'local.get $total',
      'i32.store',
      'local.get $str',
      i32Const(4),
      'i32.add',
      i32Const(0),
      'i32.store',
      'local.get $str',
      i32Const(8),
      'i32.add',
      'local.get $buf',
      'local.get $total',
      'memory.copy',
      'local.get $str',
    ],
  });

  const stdinReadLine = buildFunction({
    name: '__jswat_stdin_read_line',
    params: [],
    result: 'i32',
    locals: [
      local('buf', 'i32'),
      local('total', 'i32'),
      local('nread', 'i32'),
      local('str', 'i32'),
      local('ch', 'i32'),
    ],
    body: [
      i32Const(1024),
      i32Const(0),
      'call $__jswat_alloc_bytes',
      'local.set $buf',
      i32Const(0),
      'local.set $total',
      'block $done',
      '  loop $read',
      i32Const(ioBase + 16),
      '    local.get $buf',
      '    local.get $total',
      '    i32.add',
      '    i32.store',
      i32Const(ioBase + 20),
      i32Const(1),
      '    i32.store',
      i32Const(0),
      i32Const(ioBase + 16),
      i32Const(1),
      i32Const(ioBase + 24),
      '    call $fd_read',
      '    drop',
      i32Const(ioBase + 24),
      '    i32.load',
      '    local.set $nread',
      '    local.get $nread',
      '    i32.eqz',
      '    br_if $done',
      '    local.get $buf',
      '    local.get $total',
      '    i32.add',
      '    i32.load8_u',
      '    local.set $ch',
      '    local.get $ch',
      i32Const(10),
      '    i32.eq',
      '    br_if $done',
      '    local.get $total',
      i32Const(1),
      '    i32.add',
      '    local.set $total',
      '    local.get $total',
      i32Const(1024),
      '    i32.ge_u',
      '    br_if $done',
      '    br $read',
      '  end',
      'end',
      'local.get $total',
      'i32.eqz',
      'if',
      i32Const(0),
      '  return',
      'end',
      'local.get $total',
      i32Const(8),
      'i32.add',
      'call $__jswat_alloc',
      'local.set $str',
      'local.get $str',
      'local.get $total',
      'i32.store',
      'local.get $str',
      i32Const(4),
      'i32.add',
      i32Const(0),
      'i32.store',
      'local.get $str',
      i32Const(8),
      'i32.add',
      'local.get $buf',
      'local.get $total',
      'memory.copy',
      'local.get $str',
    ],
  });

  return [
    writeFn,
    writeLineFn,
    logFn,
    errFn,
    stdoutFn,
    stdoutWritelnFn,
    stderrFn,
    stdinRead,
    stdinReadLine,
    stdinReadAll,
  ];
}

/**
 * Build std/fs implementations backed by WASI.
 * @param {number} fsBase
 * @returns {string[]}
 */
function buildFsFunctions(fsBase) {
  const openForRead = [
    i32Const(3),
    i32Const(0),
    'local.get $path',
    i32Const(8),
    'i32.add',
    'local.get $path',
    'i32.load',
    i32Const(0),
    'i64.const 511',
    'i64.const 511',
    i32Const(0),
    i32Const(fsBase),
    'call $path_open',
  ];

  const fsRead = buildFunction({
    name: '__jswat_fs_read',
    params: [param('path', 'i32')],
    result: 'i32',
    locals: [local('fd', 'i32'), local('buf', 'i32'), local('nread', 'i32'), local('str', 'i32')],
    body: [
      ...openForRead,
      'i32.const 0',
      'i32.ne',
      'if',
      i32Const(0),
      '  return',
      'end',
      i32Const(fsBase),
      'i32.load',
      'local.set $fd',
      i32Const(4096),
      i32Const(0),
      'call $__jswat_alloc_bytes',
      'local.set $buf',
      i32Const(fsBase + 4),
      'local.get $buf',
      'i32.store',
      i32Const(fsBase + 8),
      i32Const(4096),
      'i32.store',
      'local.get $fd',
      i32Const(fsBase + 4),
      i32Const(1),
      i32Const(fsBase + 12),
      'call $fd_read',
      'drop',
      i32Const(fsBase + 12),
      'i32.load',
      'local.set $nread',
      'local.get $fd',
      'call $fd_close',
      'drop',
      'local.get $nread',
      'i32.eqz',
      'if',
      i32Const(0),
      '  return',
      'end',
      'local.get $nread',
      i32Const(8),
      'i32.add',
      'call $__jswat_alloc',
      'local.set $str',
      'local.get $str',
      'local.get $nread',
      'i32.store',
      'local.get $str',
      i32Const(4),
      'i32.add',
      i32Const(0),
      'i32.store',
      'local.get $str',
      i32Const(8),
      'i32.add',
      'local.get $buf',
      'local.get $nread',
      'memory.copy',
      'local.get $str',
    ],
  });

  const fsWrite = buildFunction({
    name: '__jswat_fs_write',
    params: [param('path', 'i32'), param('content', 'i32')],
    result: 'i32',
    locals: [local('fd', 'i32')],
    body: [
      i32Const(3),
      i32Const(0),
      'local.get $path',
      i32Const(8),
      'i32.add',
      'local.get $path',
      'i32.load',
      i32Const(9),
      'i64.const 511',
      'i64.const 511',
      i32Const(0),
      i32Const(fsBase),
      'call $path_open',
      'i32.const 0',
      'i32.ne',
      'if',
      i32Const(0),
      '  return',
      'end',
      i32Const(fsBase),
      'i32.load',
      'local.set $fd',
      i32Const(fsBase + 4),
      'local.get $content',
      i32Const(8),
      'i32.add',
      'i32.store',
      i32Const(fsBase + 8),
      'local.get $content',
      'i32.load',
      'i32.store',
      'local.get $fd',
      i32Const(fsBase + 4),
      i32Const(1),
      i32Const(fsBase + 12),
      'call $fd_write',
      'drop',
      'local.get $fd',
      'call $fd_close',
      'drop',
      i32Const(1),
    ],
  });

  const fsAppend = buildFunction({
    name: '__jswat_fs_append',
    params: [param('path', 'i32'), param('content', 'i32')],
    result: 'i32',
    locals: [local('fd', 'i32')],
    body: [
      i32Const(3),
      i32Const(0),
      'local.get $path',
      i32Const(8),
      'i32.add',
      'local.get $path',
      'i32.load',
      i32Const(1),
      'i64.const 511',
      'i64.const 511',
      i32Const(1),
      i32Const(fsBase),
      'call $path_open',
      'i32.const 0',
      'i32.ne',
      'if',
      i32Const(0),
      '  return',
      'end',
      i32Const(fsBase),
      'i32.load',
      'local.set $fd',
      i32Const(fsBase + 4),
      'local.get $content',
      i32Const(8),
      'i32.add',
      'i32.store',
      i32Const(fsBase + 8),
      'local.get $content',
      'i32.load',
      'i32.store',
      'local.get $fd',
      i32Const(fsBase + 4),
      i32Const(1),
      i32Const(fsBase + 12),
      'call $fd_write',
      'drop',
      'local.get $fd',
      'call $fd_close',
      'drop',
      i32Const(1),
    ],
  });

  const fsExists = buildFunction({
    name: '__jswat_fs_exists',
    params: [param('path', 'i32')],
    result: 'i32',
    body: [
      i32Const(3),
      i32Const(0),
      'local.get $path',
      i32Const(8),
      'i32.add',
      'local.get $path',
      'i32.load',
      i32Const(fsBase + 32),
      'call $path_filestat_get',
      'i32.eqz',
    ],
  });

  const fsDelete = buildFunction({
    name: '__jswat_fs_delete',
    params: [param('path', 'i32')],
    result: 'i32',
    body: [
      i32Const(3),
      'local.get $path',
      i32Const(8),
      'i32.add',
      'local.get $path',
      'i32.load',
      'call $path_unlink_file',
      'i32.eqz',
    ],
  });

  const fsMkdir = buildFunction({
    name: '__jswat_fs_mkdir',
    params: [param('path', 'i32')],
    result: 'i32',
    body: [
      i32Const(3),
      'local.get $path',
      i32Const(8),
      'i32.add',
      'local.get $path',
      'i32.load',
      'call $path_create_directory',
      'i32.eqz',
    ],
  });

  const fsReaddir = buildFunction({
    name: '__jswat_fs_readdir',
    params: [param('path', 'i32')],
    result: 'i32',
    body: [i32Const(0)],
  });

  return [fsRead, fsWrite, fsAppend, fsExists, fsDelete, fsMkdir, fsReaddir];
}

/**
 * Build std/clock implementations backed by WASI clock_time_get.
 * @param {number} clockBase
 * @returns {string[]}
 */
function buildClockFunctions(clockBase) {
  const clockNow = buildFunction({
    name: '__jswat_clock_now',
    params: [],
    result: 'i32',
    body: [
      i32Const(0),
      'i64.const 0',
      i32Const(clockBase),
      'call $clock_time_get',
      'drop',
      i32Const(clockBase),
      'i64.load',
      'i64.const 1000000',
      'i64.div_u',
      'i32.wrap_i64',
    ],
  });

  const clockMonotonic = buildFunction({
    name: '__jswat_clock_monotonic',
    params: [],
    result: 'i32',
    body: [
      i32Const(1),
      'i64.const 0',
      i32Const(clockBase),
      'call $clock_time_get',
      'drop',
      i32Const(clockBase),
      'i64.load',
      'i32.wrap_i64',
    ],
  });

  const clockSleep = buildFunction({
    name: '__jswat_clock_sleep',
    params: [param('ms', 'i32')],
    result: '',
    body: [],
  });

  return [clockNow, clockMonotonic, clockSleep];
}

/**
 * Build std/random implementations backed by WASI random_get with seed fallback.
 * @param {number} randomBase
 * @returns {{ globals: string[], functions: string[] }}
 */
function buildRandomFunctions(randomBase) {
  const globals = ['(global $__jswat_rng_state (mut i32) (i32.const 0))'];

  const seedFn = buildFunction({
    name: '__jswat_random_seed',
    params: [param('s', 'i32')],
    result: '',
    body: [
      'local.get $s',
      'global.set $__jswat_rng_state',
    ],
  });

  const floatFn = buildFunction({
    name: '__jswat_random_float',
    params: [],
    result: 'f64',
    locals: [local('state', 'i32')],
    body: [
      'global.get $__jswat_rng_state',
      'local.tee $state',
      'i32.eqz',
      'if',
      i32Const(randomBase),
      i32Const(8),
      'call $random_get',
      'drop',
      i32Const(randomBase),
      'i64.load',
      'f64.convert_i64_u',
      'f64.const 18446744073709551616',
      'f64.div',
      'return',
      'end',
      'local.get $state',
      'local.get $state',
      i32Const(13),
      'i32.shl',
      'i32.xor',
      'local.set $state',
      'local.get $state',
      'local.get $state',
      i32Const(17),
      'i32.shr_u',
      'i32.xor',
      'local.set $state',
      'local.get $state',
      'local.get $state',
      i32Const(5),
      'i32.shl',
      'i32.xor',
      'local.set $state',
      'local.get $state',
      'global.set $__jswat_rng_state',
      'local.get $state',
      'f64.convert_i32_u',
      'f64.const 4294967296',
      'f64.div',
    ],
  });

  return { globals, functions: [seedFn, floatFn] };
}

/**
 * @param {TypeInfo|undefined} typeInfo
 * @returns {number}
 */
function typeSize(typeInfo) {
  if (!typeInfo) return 4;
  if (typeInfo.wasmType === 'i64' || typeInfo.wasmType === 'f64') return 8;
  if (typeInfo.wasmType === 'f32') return 4;
  if (typeInfo.kind === 'bool') return 1;
  if (typeInfo.name === 'i8' || typeInfo.name === 'u8') return 1;
  if (typeInfo.name === 'i16' || typeInfo.name === 'u16') return 2;
  return 4;
}

/**
 * @param {TypeInfo|undefined} typeInfo
 * @returns {TypeInfo}
 */
function resolveFieldType(typeInfo) {
  if (!typeInfo || typeInfo.kind === 'unknown') return TYPES.isize;
  return typeInfo;
}

/**
 * @param {TypeInfo} typeInfo
 * @returns {string}
 */
function loadInstr(typeInfo) {
  const t = resolveFieldType(typeInfo);
  if (t.name === 'i8')  return 'i32.load8_s';
  if (t.name === 'u8' || t.kind === 'bool') return 'i32.load8_u';
  if (t.name === 'i16') return 'i32.load16_s';
  if (t.name === 'u16') return 'i32.load16_u';
  if (t.wasmType === 'i64') return 'i64.load';
  if (t.wasmType === 'f32') return 'f32.load';
  if (t.wasmType === 'f64') return 'f64.load';
  return 'i32.load';
}

/**
 * @param {TypeInfo} typeInfo
 * @returns {string}
 */
function storeInstr(typeInfo) {
  const t = resolveFieldType(typeInfo);
  if (t.name === 'i8' || t.name === 'u8' || t.kind === 'bool') return 'i32.store8';
  if (t.name === 'i16' || t.name === 'u16') return 'i32.store16';
  if (t.wasmType === 'i64') return 'i64.store';
  if (t.wasmType === 'f32') return 'f32.store';
  if (t.wasmType === 'f64') return 'f64.store';
  return 'i32.store';
}

/**
 * @param {Map<string, import('./typecheck.js').ClassInfo>} classes
 * @returns {Map<string, { size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>}
 */
function buildClassLayouts(classes) {
  const layouts = new Map();
  for (const classInfo of classes.values()) {
    let offset = 4; // 4-byte refcount header
    const fields = new Map();
    for (const [name, typeInfo] of classInfo.fields.entries()) {
      const resolved = resolveFieldType(typeInfo);
      const size = typeSize(resolved);
      fields.set(name, { offset, type: resolved });
      offset += size;
    }
    layouts.set(classInfo.name, { size: offset, fields });
  }
  return layouts;
}

// ── Operator → WAT instruction ───────────────────────────────────────────────

/**
 * Return the WAT binary instruction for a JS operator given the operand type.
 * @param {string} op  JS operator string
 * @param {TypeInfo} typeInfo  type of the operands
 * @returns {string}
 */
function getBinOpInstruction(op, typeInfo) {
  if (!typeInfo || !typeInfo.wasmType) {
    throw new CodegenError(`No WAT type for operator '${op}' with type '${typeInfo?.name}'`);
  }
  const wt = typeInfo.wasmType;
  const isFloat = typeInfo.isFloat;
  const s = typeInfo.isSigned ? '_s' : '_u';

  if (op === '**') throw new CodegenError('exponentiation requires std/math (Phase 2)');

  switch (op) {
    case '+':   return `${wt}.add`;
    case '-':   return `${wt}.sub`;
    case '*':   return `${wt}.mul`;
    case '/':   return isFloat ? `${wt}.div`       : `${wt}.div${s}`;
    case '%':
      if (isFloat) throw new CodegenError('% is not supported for float types');
      return `${wt}.rem${s}`;
    case '===': return `${wt}.eq`;
    case '!==': return `${wt}.ne`;
    case '<':   return isFloat ? `${wt}.lt`        : `${wt}.lt${s}`;
    case '>':   return isFloat ? `${wt}.gt`        : `${wt}.gt${s}`;
    case '<=':  return isFloat ? `${wt}.le`        : `${wt}.le${s}`;
    case '>=':  return isFloat ? `${wt}.ge`        : `${wt}.ge${s}`;
    default:
      throw new CodegenError(`Unsupported operator '${op}'`);
  }
}

// ── Local collection ─────────────────────────────────────────────────────────

/**
 * Scan a function body for all VariableDeclarator nodes and collect them as
 * locals that must be declared at the top of the WAT function.
 * @param {object} body  BlockStatement node
 * @param {Array<{ name: string, type: TypeInfo }>} params  already declared params
 * @returns {Array<{ name: string, type: TypeInfo }>}
 */
export function collectLocals(body, params) {
  const paramNames = new Set(params.map(p => p.name));
  /** @type {Array<{ name: string, type: TypeInfo }>} */
  const locals = [];
  const seen = new Set(paramNames);
  let needsTmp = false;

  /** @param {object} node */
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name && node._type) {
      const name = node.id.name;
      if (!seen.has(name)) {
        seen.add(name);
        locals.push({ name, type: node._type });
      }
    }
    if (node.type === 'NewExpression') needsTmp = true;
    if (node.type === 'ThisExpression') {
      if (!seen.has('this')) {
        seen.add('this');
        locals.push({ name: 'this', type: TYPES.isize });
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof item.type === 'string') visit(item);
        }
      } else if (child && typeof child === 'object' && typeof child.type === 'string') {
        visit(child);
      }
    }
  }

  visit(body);
  if (needsTmp && !seen.has('__tmp')) {
    locals.push({ name: '__tmp', type: TYPES.isize });
  }
  return locals;
}

// ── Expression code generation ───────────────────────────────────────────────

/**
 * Emit a std/wasm intrinsic call.
 * @param {string} fnName
 * @param {object[]} args
 * @param {string} filename
 * @param {GenContext} ctx
 * @returns {string[]}
 */
function genWasmIntrinsicCall(fnName, args, filename, ctx) {
  const op = fnName.replace('_', '.');
  const isLoad = fnName.includes('_load');
  const isStore = fnName.includes('_store');
  if (isLoad || isStore) {
    const addrInstrs = genExpr(args[0], filename, ctx);
    const offsetInstrs = args[1] ? genExpr(args[1], filename, ctx) : [i32Const(0)];
    const addr = [...addrInstrs, ...offsetInstrs, 'i32.add'];
    if (isLoad) return [...addr, op];
    const valueInstrs = args[2] ? genExpr(args[2], filename, ctx) : [i32Const(0)];
    return [...addr, ...valueInstrs, op];
  }
  const argInstrs = args.flatMap(arg => genExpr(arg, filename, ctx));
  return [...argInstrs, op];
}

/**
 * Generate WAT instructions for an expression (stack-based postfix order).
 * @param {object} node
 * @param {string} filename
 * @param {GenContext} ctx
 * @returns {string[]}
 */
function genExpr(node, filename, ctx) {
  if (!node) return [];

  switch (node.type) {
    case 'Literal': {
      const type = node._type;
      if (!type || type === TYPES.void) {
        // Fallback: infer from value
        if (typeof node.value === 'number') {
          if (Number.isInteger(node.value)) return [i32Const(node.value)];
          return [f64Const(node.value)];
        }
        return [];
      }
      if (type.name === 'str' && typeof node.value === 'string') {
        const addr = ctx._strings?.get(node.value);
        if (addr === undefined) throw new CodegenError(`Unmapped string literal (${filename})`);
        return [i32Const(addr)];
      }
      if (type.wasmType === 'i32') return [i32Const(node.value)];
      if (type.wasmType === 'i64') return [i64Const(node.value)];
      if (type.wasmType === 'f32') return [f32Const(node.value)];
      if (type.wasmType === 'f64') return [f64Const(node.value)];
      return [i32Const(node.value)];
    }

    case 'Identifier':
      return [localGet(node.name)];

    case 'BinaryExpression': {
      const leftInstrs  = genExpr(node.left,  filename, ctx);
      const rightInstrs = genExpr(node.right, filename, ctx);

      // Use the type of the left operand (both should be same after typecheck)
      const opType = node.left._type ?? node._type;
      const instr  = getBinOpInstruction(node.operator, opType);

      const instrs = [...leftInstrs, ...rightInstrs, instr];

      // Narrow-type masking after arithmetic for sub-32-bit integers
      if (opType && opType.isInteger && opType.bits > 0 && opType.bits < 32) {
        const mask = (1 << opType.bits) - 1;
        instrs.push(i32Const(mask), 'i32.and');
      }

      return instrs;
    }

    case 'UnaryExpression': {
      if (node.operator === '-') {
        // Negate: 0 - value  (WAT has no unary neg for integers)
        const argType = node.argument._type ?? TYPES.isize;
        const zero = argType.wasmType === 'f64' ? f64Const(0.0)
                   : argType.wasmType === 'f32' ? f32Const(0.0)
                   : i32Const(0);
        return [zero, ...genExpr(node.argument, filename, ctx), `${argType.wasmType}.sub`];
      }
      return genExpr(node.argument, filename, ctx);
    }

    case 'CallExpression': {
      const callee = node.callee;
      // Cast call: u8(x), i32(x), f64(x), etc.
      if (callee.type === 'Identifier') {
        const castTarget = TYPES[callee.name];
        if (castTarget && !castTarget.abstract) {
          const argInstrs = genExpr(node.arguments[0], filename, ctx);
          const srcType   = node.arguments[0]?._type;
          const convInstrs = genCastInstrs(srcType, castTarget);
          return [...argInstrs, ...convInstrs];
        }
        const stdFn = resolveStdFunction(ctx._imports, callee.name);
        if (stdFn?.intrinsic) {
          return genWasmIntrinsicCall(callee.name, node.arguments, filename, ctx);
        }
        if (stdFn?.stub) {
          const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
          return [...argInstrs, `call $${stdFn.stub}`];
        }
        const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
        return [...argInstrs, `call $${callee.name}`];
      }
      if (callee.type === 'MemberExpression') {
        const methodName = callee.property?.name;
        const objType = callee.object?._type;
        const className = objType?.kind === 'class' ? objType.name : null;
        if (callee.object.type === 'Identifier' && methodName) {
          if (callee.object.name === 'memory' && (methodName === 'copy' || methodName === 'fill')) {
            const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
            return [...argInstrs, `memory.${methodName}`];
          }
          if (['i32','i64','f32','f64'].includes(callee.object.name)) {
            const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
            const op = `${callee.object.name}.${methodName}`;
            return [...argInstrs, op];
          }
        }
        if (objType?.kind === 'collection' && methodName) {
          const std = resolveStdCollectionMethod(objType.name, methodName);
          if (std) {
            const objInstrs = genExpr(callee.object, filename, ctx);
            const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
            return [...objInstrs, ...argInstrs, `call $${std.stub}`];
          }
        }
        if (callee.object.type === 'Identifier' && methodName) {
          const ns = resolveStdNamespace(ctx._imports, callee.object.name, methodName);
          const def = resolveStdDefault(ctx._imports, callee.object.name, methodName);
          const std = ns ?? def;
          if (std) {
            const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
            return [...argInstrs, `call $${std.stub}`];
          }
        }
        const objInstrs = genExpr(callee.object, filename, ctx);
        if (!className || !methodName) {
          throw new CodegenError(`Unsupported method call (${filename})`);
        }
        const fnName = `${className}_${methodName}`;
        const argInstrs = node.arguments.flatMap(arg => genExpr(arg, filename, ctx));
        return [...objInstrs, ...argInstrs, `call $${fnName}`];
      }
      throw new CodegenError(
        `Cannot generate code for call to '${callee.name ?? '(expr)'}' — not a known cast (${filename})`
      );
    }

    case 'LogicalExpression': {
      const leftInstrs = genExpr(node.left, filename, ctx);
      const rightInstrs = genExpr(node.right, filename, ctx);
      if (node.operator === '&&') {
        return [
          ...leftInstrs,
          'if (result i32)',
          ...rightInstrs.map(i => '  ' + i),
          'else',
          ...[i32Const(0)].map(i => '  ' + i),
          'end',
        ];
      }
      if (node.operator === '||') {
        return [
          ...leftInstrs,
          'if (result i32)',
          ...[i32Const(1)].map(i => '  ' + i),
          'else',
          ...rightInstrs.map(i => '  ' + i),
          'end',
        ];
      }
      throw new CodegenError(`Unsupported logical operator '${node.operator}'`);
    }

    case 'AssignmentExpression': {
      const left = node.left;
      if (left.type === 'Identifier') {
        const name = left.name;
        const leftType = left._type ?? node._type;
        const rightInstrs = genExpr(node.right, filename, ctx);
        if (node.operator === '=') {
          return [...rightInstrs, localTee(name)];
        }
        const op = node.operator.slice(0, -1);
        const instr = getBinOpInstruction(op, leftType);
        const instrs = [localGet(name), ...rightInstrs, instr];
        const narrowed = maybeNarrowMask(leftType);
        return [...instrs, ...narrowed, localTee(name)];
      }
      if (left.type === 'MemberExpression') {
        if (node.operator !== '=') {
          throw new CodegenError(`Compound assignments on fields not supported yet (${filename})`);
        }
        const field = resolveFieldAccess(left, ctx, filename);
        const addrInstrs = field.addrInstrs;
        const valueInstrs = genExpr(node.right, filename, ctx);
        return [
          ...addrInstrs,
          ...valueInstrs,
          storeInstr(field.type),
          ...addrInstrs,
          loadInstr(field.type),
        ];
      }
      throw new CodegenError(`Unsupported assignment target (${filename})`);
    }

    case 'UpdateExpression': {
      const arg = node.argument;
      if (arg.type !== 'Identifier') {
        throw new CodegenError(`Only simple update expressions on locals are supported (${filename})`);
      }
      const name = arg.name;
      const t = arg._type ?? TYPES.isize;
      const wt = t.wasmType;
      const one = wt === 'i64' ? i64Const(1)
                : wt === 'f32' ? f32Const(1.0)
                : wt === 'f64' ? f64Const(1.0)
                : i32Const(1);
      const op = node.operator === '++' ? `${wt}.add` : `${wt}.sub`;
      if (node.prefix) {
        const instrs = [localGet(name), one, op];
        const narrowed = maybeNarrowMask(t);
        return [...instrs, ...narrowed, localTee(name)];
      }
      const instrs = [localGet(name), localGet(name), one, op];
      const narrowed = maybeNarrowMask(t);
      return [...instrs, ...narrowed, localSet(name)];
    }

    case 'ConditionalExpression': {
      // ternary: condition ? a : b
      const condInstrs = genExpr(node.test, filename, ctx);
      const thenInstrs = genExpr(node.consequent, filename, ctx);
      const elseInstrs = genExpr(node.alternate, filename, ctx);
      const resType    = toWatType(node._type);
      return [
        ...condInstrs,
        resType ? `if (result ${resType})` : 'if',
        ...thenInstrs.map(i => '  ' + i),
        'else',
        ...elseInstrs.map(i => '  ' + i),
        'end',
      ];
    }

    case 'ThisExpression':
      return [localGet('this')];

    case 'MemberExpression': {
      const field = resolveFieldAccess(node, ctx, filename);
      return [...field.addrInstrs, loadInstr(field.type)];
    }

    case 'NewExpression': {
      if (node.callee?.type === 'Identifier') {
        const className = node.callee.name;
        const ctor = resolveStdCollectionCtor(className);
        if (ctor) {
          return [`call $${ctor}`];
        }
        const layout = ctx._layouts.get(className);
        if (!layout) throw new CodegenError(`Unknown class '${className}' (${filename})`);
        const allocInstrs = [i32Const(layout.size), 'call $__alloc'];
        const storeTmp = [localTee('__tmp')];
        const initRc = [localGet('__tmp'), i32Const(1), 'i32.store'];
        const ctorInfo = ctx._classes?.get(className)?.constructor ?? null;
        if (ctorInfo) {
          const ctorName = `${className}__ctor`;
          const argInstrs = (node.arguments ?? []).flatMap(arg => genExpr(arg, filename, ctx));
          return [
            ...allocInstrs,
            ...storeTmp,
            ...initRc,
            localGet('__tmp'),
            ...argInstrs,
            `call $${ctorName}`,
            localGet('__tmp'),
          ];
        }
        return [...allocInstrs, ...storeTmp, ...initRc, localGet('__tmp')];
      }
      throw new CodegenError(`Unsupported new expression (${filename})`);
    }

    default:
      throw new CodegenError(
        `Unsupported expression node type '${node.type}' during code generation (${filename})`
      );
  }
}

/**
 * Generate expression instructions and drop the result if it is non-void.
 * @param {object} expr
 * @param {string} filename
 * @returns {string[]}
 */
function genExprStatement(expr, filename, ctx) {
  const instrs = genExpr(expr, filename, ctx);
  const exprType = expr?._type;
  if (exprType && exprType !== TYPES.void && exprType.kind !== 'void') {
    instrs.push('drop');
  }
  return instrs;
}

/**
 * Resolve a field access into address instructions and field type.
 * @param {object} node  MemberExpression
 * @param {GenContext} ctx
 * @param {string} filename
 * @returns {{ addrInstrs: string[], type: TypeInfo }}
 */
function resolveFieldAccess(node, ctx, filename) {
  const objType = node.object?._type;
  const className = objType?.kind === 'class' ? objType.name : null;
  const fieldName = node.property?.name;
  if (!className || !fieldName) {
    throw new CodegenError(`Unsupported field access (${filename})`);
  }
  const layout = ctx._layouts.get(className);
  if (!layout || !layout.fields.has(fieldName)) {
    throw new CodegenError(`Unknown field '${className}.${fieldName}' (${filename})`);
  }
  const field = layout.fields.get(fieldName);
  const addrInstrs = [
    ...genExpr(node.object, filename, ctx),
    i32Const(field.offset),
    'i32.add',
  ];
  return { addrInstrs, type: field.type };
}

/**
 * Generate conversion instructions between two concrete types.
 * Returns an empty array when no conversion is needed.
 * @param {TypeInfo|undefined} src
 * @param {TypeInfo} dst
 * @returns {string[]}
 */
function genCastInstrs(src, dst) {
  if (!src || src === dst) return [];
  // Same WASM type — may still need narrow-type masking
  if (src.wasmType === dst.wasmType) {
    // Mask sub-32-bit integers to their declared width (wrapping semantics)
    if (dst.isInteger && dst.bits > 0 && dst.bits < 32) {
      const mask = (1 << dst.bits) - 1;
      return [i32Const(mask), 'i32.and'];
    }
    return [];
  }
  // Integer → float conversions
  if (src.isInteger && dst.isFloat) {
    const srcWasm = src.wasmType;  // i32 or i64
    const dstWasm = dst.wasmType;  // f32 or f64
    const sign = src.isSigned ? '_s' : '_u';
    return [`${dstWasm}.convert_${srcWasm}${sign}`];
  }
  // Float → integer truncation
  if (src.isFloat && dst.isInteger) {
    const srcWasm = src.wasmType;
    const dstWasm = dst.wasmType;
    const sign = dst.isSigned ? '_s' : '_u';
    return [`${dstWasm}.trunc_${srcWasm}${sign}`];
  }
  // f32 ↔ f64
  if (src.wasmType === 'f32' && dst.wasmType === 'f64') return ['f64.promote_f32'];
  if (src.wasmType === 'f64' && dst.wasmType === 'f32') return ['f32.demote_f64'];
  return [];
}

/**
 * Emit masking to wrap sub-32-bit integers.
 * @param {TypeInfo|undefined|null} typeInfo
 * @returns {string[]}
 */
function maybeNarrowMask(typeInfo) {
  if (!typeInfo) return [];
  if (typeInfo.isInteger && typeInfo.bits > 0 && typeInfo.bits < 32) {
    const mask = (1 << typeInfo.bits) - 1;
    return [i32Const(mask), 'i32.and'];
  }
  return [];
}

// ── Statement code generation ─────────────────────────────────────────────────

/**
 * Generate WAT instructions for a statement.
 * @param {object} stmt
 * @param {TypeInfo|null} fnReturnType  inferred function return type
 * @param {GenContext} ctx
 * @param {string} filename
 * @returns {string[]}
 */
function genStatement(stmt, fnReturnType, ctx, filename) {
  if (!stmt) return [];

  switch (stmt.type) {
    case 'ReturnStatement': {
      if (!stmt.argument) return ['return'];
      return [...genExpr(stmt.argument, filename, ctx), 'return'];
    }

    case 'VariableDeclaration': {
      const instrs = [];
      for (const decl of stmt.declarations) {
        if (decl.init) {
          instrs.push(...genExpr(decl.init, filename, ctx));
          instrs.push(localSet(decl.id.name));
        }
      }
      return instrs;
    }

    case 'ExpressionStatement':
      return genExprStatement(stmt.expression, filename, ctx);

    case 'BlockStatement': {
      const instrs = [];
      for (const s of stmt.body) instrs.push(...genStatement(s, fnReturnType, ctx, filename));
      return instrs;
    }

    case 'IfStatement': {
      const condInstrs = genExpr(stmt.test, filename, ctx);
      const hasElse    = !!stmt.alternate;

      // Use a value-producing if/else block when the function has a return type
      // and all branches unconditionally return (handles else-if chains recursively).
      if (hasElse && fnReturnType && toWatType(fnReturnType) &&
          alwaysReturns(stmt.consequent) && alwaysReturns(stmt.alternate)) {
        const resType    = toWatType(fnReturnType);
        const thenInstrs = genBranchValue(stmt.consequent, fnReturnType, ctx, filename);
        const elseInstrs = genBranchValue(stmt.alternate,  fnReturnType, ctx, filename);
        return [
          ...condInstrs,
          `if (result ${resType})`,
          ...thenInstrs.map(i => '  ' + i),
          'else',
          ...elseInstrs.map(i => '  ' + i),
          'end',
          'return',
        ];
      }

      // Simple if (no result type needed — e.g. side-effects only, or void branch)
      const thenInstrs = blockBody(stmt.consequent)
        .flatMap(s => genStatement(s, fnReturnType, ctx, filename));
      if (hasElse) {
        const elseInstrs = blockBody(stmt.alternate)
          .flatMap(s => genStatement(s, fnReturnType, ctx, filename));
        return [
          ...condInstrs,
          'if',
          ...thenInstrs.map(i => '  ' + i),
          'else',
          ...elseInstrs.map(i => '  ' + i),
          'end',
        ];
      }
      return [
        ...condInstrs,
        'if',
        ...thenInstrs.map(i => '  ' + i),
        'end',
      ];
    }

    case 'WhileStatement': {
      const brk = ctx.nextLabel('brk');
      const lp = ctx.nextLabel('lp');
      ctx.pushLoop(brk, lp);
      const condInstrs = genExpr(stmt.test, filename, ctx);
      const bodyInstrs = genStatement(stmt.body, fnReturnType, ctx, filename);
      ctx.popLoop();
      return [
        `block $${brk}`,
        `  loop $${lp}`,
        ...condInstrs.map(i => '    ' + i),
        `    i32.eqz`,
        `    br_if $${brk}`,
        ...bodyInstrs.map(i => '    ' + i),
        `    br $${lp}`,
        '  end',
        'end',
      ];
    }

    case 'DoWhileStatement': {
      const brk = ctx.nextLabel('brk');
      const lp = ctx.nextLabel('lp');
      const cont = ctx.nextLabel('cont');
      ctx.pushLoop(brk, cont);
      const bodyInstrs = genStatement(stmt.body, fnReturnType, ctx, filename);
      const condInstrs = genExpr(stmt.test, filename, ctx);
      ctx.popLoop();
      return [
        `block $${brk}`,
        `  loop $${lp}`,
        `    block $${cont}`,
        ...bodyInstrs.map(i => '      ' + i),
        '    end',
        ...condInstrs.map(i => '    ' + i),
        `    br_if $${lp}`,
        '  end',
        'end',
      ];
    }

    case 'ForStatement': {
      const initInstrs = [];
      if (stmt.init) {
        if (stmt.init.type === 'VariableDeclaration') {
          initInstrs.push(...genStatement(stmt.init, fnReturnType, ctx, filename));
        } else {
          initInstrs.push(...genExprStatement(stmt.init, filename, ctx));
        }
      }
      const brk = ctx.nextLabel('brk');
      const lp = ctx.nextLabel('lp');
      const inner = ctx.nextLabel('inner');
      ctx.pushLoop(brk, inner);
      const condInstrs = stmt.test ? genExpr(stmt.test, filename, ctx) : [];
      const updateInstrs = stmt.update ? genExprStatement(stmt.update, filename, ctx) : [];
      const bodyInstrs = genStatement(stmt.body, fnReturnType, ctx, filename);
      ctx.popLoop();
      const loopInstrs = [
        `block $${brk}`,
        `  loop $${lp}`,
      ];
      if (condInstrs.length > 0) {
        loopInstrs.push(...condInstrs.map(i => '    ' + i));
        loopInstrs.push('    i32.eqz');
        loopInstrs.push(`    br_if $${brk}`);
      }
      loopInstrs.push(`    block $${inner}`);
      loopInstrs.push(...bodyInstrs.map(i => '      ' + i));
      loopInstrs.push('    end');
      loopInstrs.push(...updateInstrs.map(i => '    ' + i));
      loopInstrs.push(`    br $${lp}`);
      loopInstrs.push('  end');
      loopInstrs.push('end');
      return [...initInstrs, ...loopInstrs];
    }

    case 'BreakStatement': {
      const loop = ctx.currentLoop();
      if (!loop) throw new CodegenError(`break used outside loop (${filename})`);
      return [`br $${loop.breakLabel}`];
    }

    case 'ContinueStatement': {
      const loop = ctx.currentLoop();
      if (!loop) throw new CodegenError(`continue used outside loop (${filename})`);
      return [`br $${loop.continueLabel}`];
    }

    default:
      return [];
  }
}

/**
 * Get the statements inside a block or treat a single statement as a 1-element list.
 * @param {object|null} node
 * @returns {object[]}
 */
function blockBody(node) {
  if (!node) return [];
  if (node.type === 'BlockStatement') return node.body;
  return [node];
}

/**
 * True if a branch (block or statement) unconditionally returns in all code paths.
 * Handles `else if` chains by recursing into IfStatement alternates.
 * @param {object|null} node
 * @returns {boolean}
 */
function alwaysReturns(node) {
  if (!node) return false;
  const stmts = blockBody(node);
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  if (last.type === 'ReturnStatement') return true;
  if (last.type === 'IfStatement' && last.alternate) {
    return alwaysReturns(last.consequent) && alwaysReturns(last.alternate);
  }
  return false;
}

/**
 * Generate value instructions for a branch that unconditionally returns.
 * Emits the VALUE only (no `return` instruction) so the result is left on the stack
 * inside a result-typed `if` block.  Handles nested `else if` chains recursively.
 * @param {object} node  branch node (BlockStatement or IfStatement)
 * @param {TypeInfo} fnReturnType
 * @param {string} filename
 * @returns {string[]}
 */
function genBranchValue(node, fnReturnType, ctx, filename) {
  const instrs = [];
  for (const s of blockBody(node)) {
    if (s.type === 'ReturnStatement') {
      instrs.push(...(s.argument ? genExpr(s.argument, filename, ctx) : []));
    } else if (s.type === 'IfStatement' && alwaysReturns(s)) {
      // Nested always-returning if — generate as a nested value-producing block
      const resType    = toWatType(fnReturnType);
      const condInstrs = genExpr(s.test, filename, ctx);
      const thenInstrs = genBranchValue(s.consequent, fnReturnType, ctx, filename);
      const elseInstrs = s.alternate
        ? genBranchValue(s.alternate, fnReturnType, ctx, filename)
        : [];
      instrs.push(...condInstrs);
      instrs.push(`if (result ${resType})`);
      for (const i of thenInstrs) instrs.push('  ' + i);
      if (elseInstrs.length > 0) {
        instrs.push('else');
        for (const i of elseInstrs) instrs.push('  ' + i);
      }
      instrs.push('end');
    } else {
      instrs.push(...genStatement(s, fnReturnType, ctx, filename));
    }
  }
  return instrs;
}

// ── Top-level WAT generation ─────────────────────────────────────────────────

/**
 * Generate a complete WAT module string from a type-annotated Program AST.
 * All top-level FunctionDeclarations are exported (Phase 1 convenience).
 *
 * @param {object} ast  type-annotated acorn Program AST
 * @param {Map<string, FunctionSignature>} signatures
 * @param {Map<string, import('./typecheck.js').ClassInfo>} classes
 * @param {string} [filename='<input>']
 * @returns {string}  WAT module text
 */
export function generateWat(ast, signatures, classes, imports, filename = '<input>') {
  const functions = [];
  const { globals: allocGlobals, functions: allocFunctions } = buildAllocator();
  const layouts = buildClassLayouts(classes);
  const stringTable = buildStringTable(ast);
  const stdStubs = collectStdStubs(imports);
  const hasIo = stdStubs.has('__jswat_console_log') ||
    stdStubs.has('__jswat_console_error') ||
    stdStubs.has('__jswat_stdout_write') ||
    stdStubs.has('__jswat_stdout_writeln') ||
    stdStubs.has('__jswat_stderr_write') ||
    stdStubs.has('__jswat_stdin_read') ||
    stdStubs.has('__jswat_stdin_read_line') ||
    stdStubs.has('__jswat_stdin_read_all');
  const hasFs = stdStubs.has('__jswat_fs_read') ||
    stdStubs.has('__jswat_fs_write') ||
    stdStubs.has('__jswat_fs_append') ||
    stdStubs.has('__jswat_fs_exists') ||
    stdStubs.has('__jswat_fs_delete') ||
    stdStubs.has('__jswat_fs_mkdir') ||
    stdStubs.has('__jswat_fs_readdir');
  const hasClock = stdStubs.has('__jswat_clock_now') ||
    stdStubs.has('__jswat_clock_monotonic') ||
    stdStubs.has('__jswat_clock_sleep');
  const hasRandom = stdStubs.has('__jswat_random_float') ||
    stdStubs.has('__jswat_random_seed');
  const hasMem = Array.from(stdStubs).some(name => name.startsWith('__jswat_alloc_') || name.startsWith('__jswat_ptr_'));
  const topLevelStmts = ast.body.filter(n =>
    n.type !== 'FunctionDeclaration' &&
    n.type !== 'ClassDeclaration' &&
    n.type !== 'ImportDeclaration'
  );

  for (const node of ast.body) {
    if (node.type !== 'FunctionDeclaration') continue;
    functions.push(genFunction(node, signatures, classes, layouts, imports, stringTable, filename));
  }

  for (const classInfo of classes.values()) {
    for (const [methodName, method] of classInfo.methods.entries()) {
      functions.push(genMethod(classInfo, methodName, method.node, method.signature, classes, layouts, imports, stringTable, filename));
    }
    if (classInfo.constructor) {
      functions.push(genConstructor(classInfo, classInfo.constructor.node, classInfo.constructor.signature, classes, layouts, imports, stringTable, filename));
    }
  }

  for (const stub of stdStubs) {
    if (hasIo && stub.startsWith('__jswat_') &&
        (stub.includes('console') || stub.includes('stdout') || stub.includes('stderr') || stub.includes('stdin'))) {
      continue;
    }
    if (hasFs && stub.startsWith('__jswat_fs_')) {
      continue;
    }
    if (hasClock && stub.startsWith('__jswat_clock_')) {
      continue;
    }
    if (hasRandom && stub.startsWith('__jswat_random_')) {
      continue;
    }
    if (hasMem && (stub.startsWith('__jswat_alloc_') || stub.startsWith('__jswat_ptr_'))) {
      continue;
    }
    functions.push(buildStdStub(stub));
  }

  const ioBase = Math.max(Math.ceil(stringTable.size / 16) * 16, 256);
  if (hasIo) {
    functions.push(...buildIoFunctions(ioBase));
  }
  if (hasFs) {
    const fsBase = ioBase + 64;
    functions.push(...buildFsFunctions(fsBase));
  }
  let extraGlobals = [];
  if (hasClock) {
    const clockBase = ioBase + 128;
    functions.push(...buildClockFunctions(clockBase));
  }
  if (hasRandom) {
    const randomBase = ioBase + 192;
    const random = buildRandomFunctions(randomBase);
    extraGlobals = extraGlobals.concat(random.globals);
    for (const fn of random.functions) functions.push(fn);
  }
  if (hasMem) {
    functions.push(...buildMemFunctions());
  }

  for (const fn of allocFunctions) functions.push(fn);

  if (topLevelStmts.length > 0) {
    const startName = '__start';
    const ctx = new GenContext(classes, layouts, imports);
    ctx._strings = stringTable.map;
    const fakeBlock = { type: 'BlockStatement', body: topLevelStmts };
    const locals = collectLocals(fakeBlock, []);
    const localDecls = locals.map(l => local(l.name, toWatType(l.type)));
    const body = topLevelStmts.flatMap(stmt => genStatement(stmt, TYPES.void, ctx, filename));
    functions.push(buildFunction({
      name: startName,
      params: [],
      result: '',
      locals: localDecls,
      body,
      export: startName,
    }));
    functions.push(buildFunction({
      name: '_start',
      params: [],
      result: '',
      body: [
        `call $${startName}`,
      ],
      export: '_start',
    }));
  }

  return buildModule({
    memories:  [memoryExport(1)],
    globals:   allocGlobals.concat(extraGlobals),
    imports:   (hasIo || hasFs || hasClock || hasRandom) ? buildWasiImports(hasIo, hasFs, hasClock, hasRandom) : [],
    data:      stringTable.data,
    functions,
  });
}

/**
 * Generate the WAT text for a single FunctionDeclaration.
 * @param {object} node
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} filename
 * @returns {string}
 */
function genFunction(node, signatures, classes, layouts, imports, stringTable, filename) {
  const name = node.id.name;
  const sig  = signatures.get(name);
  if (!sig) throw new CodegenError(`No signature for function '${name}' (${filename})`);

  // Build param declarations
  const paramDecls = sig.params.map(p => param(p.name, toWatType(p.type)));

  // Collect locals (variable declarations inside the body)
  const localVars = collectLocals(node.body, sig.params);
  const localDecls = localVars.map(l => local(l.name, toWatType(l.type)));

  // Generate body instructions
  const returnType = sig.returnType;
  const ctx = new GenContext(classes, layouts, imports);
  ctx._strings = stringTable.map;
  const body = node.body.body.flatMap(
    stmt => genStatement(stmt, returnType, ctx, filename)
  );

  return buildFunction({
    name,
    params:  paramDecls,
    result:  toWatType(returnType),
    locals:  localDecls,
    body,
    export: name,   // Phase 1: all top-level functions are exported by their JS name
  });
}

/**
 * Generate WAT for a class method.
 * @param {import('./typecheck.js').ClassInfo} classInfo
 * @param {string} methodName
 * @param {object} fnNode
 * @param {FunctionSignature} sig
 * @param {Map<string, import('./typecheck.js').ClassInfo>} classes
 * @param {Map<string, { size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>} layouts
 * @param {Map<string, { kind: string, module: string, name: string }>|null} imports
 * @param {string} filename
 * @returns {string}
 */
function genMethod(classInfo, methodName, fnNode, sig, classes, layouts, imports, stringTable, filename) {
  const name = `${classInfo.name}_${methodName}`;
  const params = [param('this', 'i32'), ...sig.params.map(p => param(p.name, toWatType(p.type)))];
  const localVars = collectLocals(fnNode.body, [{ name: 'this', type: classInfo.type }, ...sig.params]);
  const localDecls = localVars.map(l => local(l.name, toWatType(l.type)));
  const ctx = new GenContext(classes, layouts, imports);
  ctx._strings = stringTable.map;
  const body = fnNode.body.body.flatMap(
    stmt => genStatement(stmt, sig.returnType, ctx, filename)
  );
  return buildFunction({
    name,
    params,
    result: toWatType(sig.returnType),
    locals: localDecls,
    body,
  });
}

/**
 * Generate WAT for a class constructor.
 * @param {import('./typecheck.js').ClassInfo} classInfo
 * @param {object} fnNode
 * @param {FunctionSignature} sig
 * @param {Map<string, import('./typecheck.js').ClassInfo>} classes
 * @param {Map<string, { size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>} layouts
 * @param {Map<string, { kind: string, module: string, name: string }>|null} imports
 * @param {string} filename
 * @returns {string}
 */
function genConstructor(classInfo, fnNode, sig, classes, layouts, imports, stringTable, filename) {
  const name = `${classInfo.name}__ctor`;
  const params = [param('this', 'i32'), ...sig.params.map(p => param(p.name, toWatType(p.type)))];
  const localVars = collectLocals(fnNode.body, [{ name: 'this', type: classInfo.type }, ...sig.params]);
  const localDecls = localVars.map(l => local(l.name, toWatType(l.type)));
  const ctx = new GenContext(classes, layouts, imports);
  ctx._strings = stringTable.map;
  const body = fnNode.body.body.flatMap(
    stmt => genStatement(stmt, TYPES.void, ctx, filename)
  );
  return buildFunction({
    name,
    params,
    result: '',
    locals: localDecls,
    body,
  });
}
