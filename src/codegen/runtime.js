/**
 * @fileoverview Runtime helper functions (binaryen IR):
 * std stubs, mem, array, string, collections, WASI imports, io, fs, clock, random.
 */

import binaryen from 'binaryen';

const i32  = binaryen.i32;
const i64  = binaryen.i64;
const f64  = binaryen.f64;
const none = binaryen.none;

// ── Std stubs ─────────────────────────────────────────────────────────────────

/**
 * Build a no-op stdlib stub so calls resolve even without WASI.
 * @param {any} mod  binaryen Module
 * @param {string} name
 */
export function buildStdStub(mod, name) {
  // Lookup table for known functions with non-trivial signatures.
  const KNOWN = {
    '__jswat_random_float':    { p: [],      r: f64,  body: () => mod.f64.const(0) },
    '__jswat_random_seed':     { p: [i32],   r: none, body: () => mod.nop() },
    '__jswat_random_int':      { p: [i32,i32], r: i32, body: () => mod.return(mod.i32.const(0)) },
    '__jswat_random_shuffle':  { p: [i32,i32], r: none, body: () => mod.nop() },
    '__jswat_clock_now':       { p: [],      r: i32,  body: () => mod.return(mod.i32.const(0)) },
    '__jswat_clock_monotonic': { p: [],      r: i32,  body: () => mod.return(mod.i32.const(0)) },
    '__jswat_clock_sleep':     { p: [i32,i32], r: none, body: () => mod.nop() },
    '__jswat_fs_read':         { p: [i32],   r: i32,  body: () => mod.return(mod.i32.const(0)) },
    '__jswat_fs_write':        { p: [i32,i32], r: none, body: () => mod.nop() },
    '__jswat_fs_append':       { p: [i32,i32], r: none, body: () => mod.nop() },
    '__jswat_fs_exists':       { p: [i32],   r: i32,  body: () => mod.return(mod.i32.const(0)) },
    '__jswat_fs_delete':       { p: [i32],   r: none, body: () => mod.nop() },
    '__jswat_fs_mkdir':        { p: [i32],   r: none, body: () => mod.nop() },
  };
  const known = KNOWN[name];
  if (known) {
    mod.addFunction(name, binaryen.createType(known.p), known.r, [], known.body());
    return;
  }
  const hasArg    = name.includes('write') || name.includes('log') || name.includes('error');
  const returnsPtr = name.includes('read') || name.includes('from');
  const params = hasArg ? binaryen.createType([i32]) : binaryen.createType([]);
  const result = returnsPtr ? i32 : none;
  const body   = returnsPtr ? mod.return(mod.i32.const(0)) : mod.nop();
  mod.addFunction(name, params, result, [], body);
}

// ── WASI imports ──────────────────────────────────────────────────────────────

/**
 * Add WASI function imports to the binaryen module.
 * @param {any} mod
 * @param {boolean} hasIo
 * @param {boolean} hasFs
 * @param {boolean} hasClock
 * @param {boolean} hasRandom
 * @param {boolean} [hasProcess]
 */
export function buildWasiImports(mod, hasIo, hasFs, hasClock, hasRandom, hasProcess = false) {
  if (hasIo || hasFs) {
    mod.addFunctionImport('fd_write', 'wasi_snapshot_preview1', 'fd_write',
      binaryen.createType([i32, i32, i32, i32]), i32);
    mod.addFunctionImport('fd_read', 'wasi_snapshot_preview1', 'fd_read',
      binaryen.createType([i32, i32, i32, i32]), i32);
  }
  if (hasFs) {
    mod.addFunctionImport('fd_close', 'wasi_snapshot_preview1', 'fd_close',
      binaryen.createType([i32]), i32);
    mod.addFunctionImport('path_open', 'wasi_snapshot_preview1', 'path_open',
      binaryen.createType([i32, i32, i32, i32, i32, i64, i64, i32, i32]), i32);
    mod.addFunctionImport('path_filestat_get', 'wasi_snapshot_preview1', 'path_filestat_get',
      binaryen.createType([i32, i32, i32, i32, i32]), i32);
    mod.addFunctionImport('path_create_directory', 'wasi_snapshot_preview1', 'path_create_directory',
      binaryen.createType([i32, i32, i32]), i32);
    mod.addFunctionImport('path_unlink_file', 'wasi_snapshot_preview1', 'path_unlink_file',
      binaryen.createType([i32, i32, i32]), i32);
  }
  if (hasClock) {
    mod.addFunctionImport('clock_time_get', 'wasi_snapshot_preview1', 'clock_time_get',
      binaryen.createType([i32, i64, i32]), i32);
    mod.addFunctionImport('sched_yield', 'wasi_snapshot_preview1', 'sched_yield',
      binaryen.createType([]), i32);
  }
  if (hasRandom) {
    mod.addFunctionImport('random_get', 'wasi_snapshot_preview1', 'random_get',
      binaryen.createType([i32, i32]), i32);
  }
  if (hasProcess) {
    mod.addFunctionImport('proc_exit', 'wasi_snapshot_preview1', 'proc_exit',
      binaryen.createType([i32]), none);
  }
}

// ── std/mem ───────────────────────────────────────────────────────────────────

/**
 * Build std/mem helper functions.
 * @param {any} mod
 */
export function buildMemFunctions(mod) {
  // __jswat_alloc_copy(dst:i32, src:i32, n:i32) -> void
  mod.addFunction('__jswat_alloc_copy',
    binaryen.createType([i32, i32, i32]), none, [],
    mod.memory.copy(
      mod.local.get(0, i32),
      mod.local.get(1, i32),
      mod.local.get(2, i32)));

  // __jswat_alloc_fill(dst:i32, value:i32, n:i32) -> void
  mod.addFunction('__jswat_alloc_fill',
    binaryen.createType([i32, i32, i32]), none, [],
    mod.memory.fill(
      mod.local.get(0, i32),
      mod.local.get(1, i32),
      mod.local.get(2, i32)));

  // __jswat_alloc_realloc(ptr:i32, newSize:i32) -> i32
  // params: ptr(0), newSize(1); locals: newPtr(2)
  {
    const getPtr   = () => mod.local.get(0, i32);
    const getNewSz = () => mod.local.get(1, i32);
    const getNewP  = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.call('__jswat_alloc_bytes', [getNewSz(), mod.i32.const(0)], i32)),
      mod.memory.copy(getNewP(), getPtr(), getNewSz()),
      mod.return(getNewP()),
    ], i32);
    mod.addFunction('__jswat_alloc_realloc',
      binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // __jswat_ptr_from_addr(addr:i32) -> i32  (identity)
  mod.addFunction('__jswat_ptr_from_addr',
    binaryen.createType([i32]), i32, [],
    mod.return(mod.local.get(0, i32)));

  // __jswat_ptr_diff(a:i32, b:i32) -> i32
  mod.addFunction('__jswat_ptr_diff',
    binaryen.createType([i32, i32]), i32, [],
    mod.return(mod.i32.sub(mod.local.get(0, i32), mod.local.get(1, i32))));
}

// ── std/array ─────────────────────────────────────────────────────────────────
// Layout: [rc:4][len:4][cap:4][data_ptr:4]
// Node size: 16 bytes

/**
 * Build array helper functions.
 * @param {any} mod
 */
export function buildArrayFunctions(mod) {
  // __jswat_array_new(cap:i32) -> i32
  // params: cap(0); locals: ptr(1), bytes(2)
  {
    const getCap   = () => mod.local.get(0, i32);
    const getPtr   = () => mod.local.get(1, i32);
    const getBytes = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.call('__alloc', [mod.i32.const(16)], i32)),
      mod.i32.store(4, 0, getPtr(), mod.i32.const(0)),          // len = 0
      mod.i32.store(8, 0, getPtr(), getCap()),                   // cap = cap
      mod.local.set(2, mod.i32.mul(getCap(), mod.i32.const(4))), // bytes = cap*4
      mod.i32.store(12, 0, getPtr(),
        mod.call('__jswat_alloc_bytes', [getBytes(), mod.i32.const(0)], i32)),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_array_new',
      binaryen.createType([i32]), i32, [i32, i32], body);
  }

  // __jswat_array_length(arr:i32) -> i32
  {
    const getArr = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_array_length',
      binaryen.createType([i32]), i32, [],
      mod.if(
        mod.i32.eqz(getArr()),
        mod.i32.const(0),
        mod.i32.load(4, 0, getArr())));
  }

  // __jswat_array_get(arr:i32, idx:i32) -> i32
  {
    const getArr = () => mod.local.get(0, i32);
    const getIdx = () => mod.local.get(1, i32);
    mod.addFunction('__jswat_array_get',
      binaryen.createType([i32, i32]), i32, [],
      mod.i32.load(0, 0,
        mod.i32.add(
          mod.i32.load(12, 0, getArr()),
          mod.i32.mul(getIdx(), mod.i32.const(4)))));
  }

  // __jswat_array_set(arr:i32, idx:i32, value:i32) -> void
  {
    const getArr = () => mod.local.get(0, i32);
    const getIdx = () => mod.local.get(1, i32);
    const getVal = () => mod.local.get(2, i32);
    mod.addFunction('__jswat_array_set',
      binaryen.createType([i32, i32, i32]), none, [],
      mod.i32.store(0, 0,
        mod.i32.add(
          mod.i32.load(12, 0, getArr()),
          mod.i32.mul(getIdx(), mod.i32.const(4))),
        getVal()));
  }

  // __jswat_array_push(arr:i32, value:i32) -> i32
  // params: arr(0), value(1); locals: len(2), cap(3), data(4), newCap(5), newData(6)
  {
    const getArr  = () => mod.local.get(0, i32);
    const getVal  = () => mod.local.get(1, i32);
    const getLen  = () => mod.local.get(2, i32);
    const getCap  = () => mod.local.get(3, i32);
    const getData = () => mod.local.get(4, i32);
    const getNC   = () => mod.local.get(5, i32);
    const getND   = () => mod.local.get(6, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.i32.load(4, 0, getArr())),
      mod.local.set(3, mod.i32.load(8, 0, getArr())),
      mod.local.set(4, mod.i32.load(12, 0, getArr())),
      mod.if(mod.i32.ge_u(getLen(), getCap()),
        mod.block(null, [
          mod.local.set(5, mod.i32.add(mod.i32.mul(getCap(), mod.i32.const(2)), mod.i32.const(4))),
          mod.local.set(6, mod.call('__jswat_alloc_bytes',
            [mod.i32.mul(getNC(), mod.i32.const(4)), mod.i32.const(0)], i32)),
          mod.memory.copy(getND(), getData(), mod.i32.mul(getCap(), mod.i32.const(4))),
          mod.i32.store(12, 0, getArr(), getND()),
          mod.i32.store(8, 0, getArr(), getNC()),
          mod.local.set(4, getND()),
          mod.local.set(3, getNC()),
        ], none)
      ),
      mod.i32.store(0, 0,
        mod.i32.add(getData(), mod.i32.mul(getLen(), mod.i32.const(4))), getVal()),
      mod.local.set(2, mod.i32.add(getLen(), mod.i32.const(1))),
      mod.i32.store(4, 0, getArr(), getLen()),
      mod.return(getLen()),
    ], i32);
    mod.addFunction('__jswat_array_push',
      binaryen.createType([i32, i32]), i32,
      [i32, i32, i32, i32, i32], body);
  }

  // __jswat_array_pop(arr:i32) -> i32
  // params: arr(0); locals: len(1), data(2)
  {
    const getArr  = () => mod.local.get(0, i32);
    const getLen  = () => mod.local.get(1, i32);
    const getData = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.i32.load(4, 0, getArr())),
      mod.if(mod.i32.eqz(getLen()), mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.sub(getLen(), mod.i32.const(1))),
      mod.i32.store(4, 0, getArr(), getLen()),
      mod.local.set(2, mod.i32.load(12, 0, getArr())),
      mod.return(mod.i32.load(0, 0,
        mod.i32.add(getData(), mod.i32.mul(getLen(), mod.i32.const(4))))),
    ], i32);
    mod.addFunction('__jswat_array_pop',
      binaryen.createType([i32]), i32, [i32, i32], body);
  }
}

// ── std/string ────────────────────────────────────────────────────────────────

/**
 * Build std/string functions.
 * @param {any} mod
 */
export function buildStringFunctions(mod) {
  // __jswat_string_from_i32(value:i32) -> i32
  // params: value(0); locals: abs(1), tmp(2), len(3), ptr(4), isNeg(5), write(6)
  const getValue = () => mod.local.get(0, i32);
  const getAbs   = () => mod.local.get(1, i32);
  const getTmp   = () => mod.local.get(2, i32);
  const getLen   = () => mod.local.get(3, i32);
  const getPtr   = () => mod.local.get(4, i32);
  const getIsNeg = () => mod.local.get(5, i32);
  const getWrite = () => mod.local.get(6, i32);

  const body = mod.block(null, [
    // abs = value
    mod.local.set(1, getValue()),
    // if value < 0: isNeg=1, abs=value*-1; else isNeg=0
    mod.if(
      mod.i32.lt_s(getValue(), mod.i32.const(0)),
      mod.block(null, [
        mod.local.set(5, mod.i32.const(1)),
        mod.local.set(1, mod.i32.mul(getValue(), mod.i32.const(-1))),
      ], none),
      mod.local.set(5, mod.i32.const(0))
    ),
    // compute len: if abs==0 then 1 else count digits
    mod.if(
      mod.i32.eqz(getAbs()),
      mod.local.set(3, mod.i32.const(1)),
      mod.block(null, [
        mod.local.set(3, mod.i32.const(0)),
        mod.local.set(2, getAbs()),
        mod.block('count_done', [
          mod.loop('count', mod.block(null, [
            mod.br_if('count_done', mod.i32.eqz(getTmp())),
            mod.local.set(2, mod.i32.div_u(getTmp(), mod.i32.const(10))),
            mod.local.set(3, mod.i32.add(getLen(), mod.i32.const(1))),
            mod.br('count'),
          ], none)),
        ], none),
      ], none)
    ),
    // if isNeg: len++
    mod.if(getIsNeg(), mod.local.set(3, mod.i32.add(getLen(), mod.i32.const(1)))),
    // ptr = alloc(len+12)  — 12-byte header: [rc:4][len:4][hash:4][bytes...]
    mod.local.set(4, mod.call('__jswat_alloc',
      [mod.i32.add(getLen(), mod.i32.const(12))], i32)),
    // ptr[0]=rc=1, ptr[4]=len, ptr[8]=hash=0
    mod.i32.store(0, 0, getPtr(), mod.i32.const(1)),
    mod.i32.store(4, 0, getPtr(), getLen()),
    mod.i32.store(8, 0, getPtr(), mod.i32.const(0)),
    // write = ptr + 12 + len - 1
    mod.local.set(6, mod.i32.sub(
      mod.i32.add(getPtr(), mod.i32.add(mod.i32.const(12), getLen())),
      mod.i32.const(1))),
    // write digits backwards
    mod.if(
      mod.i32.eqz(getAbs()),
      mod.block(null, [
        mod.i32.store8(0, 0, getWrite(), mod.i32.const(48)),  // '0'
        mod.local.set(6, mod.i32.sub(getWrite(), mod.i32.const(1))),
      ], none),
      mod.block(null, [
        mod.local.set(2, getAbs()),
        mod.block('write_done', [
          mod.loop('write_loop', mod.block(null, [
            mod.br_if('write_done', mod.i32.eqz(getTmp())),
            mod.i32.store8(0, 0, getWrite(),
              mod.i32.add(mod.i32.rem_u(getTmp(), mod.i32.const(10)), mod.i32.const(48))),
            mod.local.set(6, mod.i32.sub(getWrite(), mod.i32.const(1))),
            mod.local.set(2, mod.i32.div_u(getTmp(), mod.i32.const(10))),
            mod.br('write_loop'),
          ], none)),
        ], none),
      ], none)
    ),
    // if isNeg: write '-' at ptr+12
    mod.if(getIsNeg(),
      mod.i32.store8(0, 0, mod.i32.add(getPtr(), mod.i32.const(12)), mod.i32.const(45))),
    mod.return(getPtr()),
  ], i32);

  mod.addFunction('__jswat_string_from_i32',
    binaryen.createType([i32]), i32,
    [i32, i32, i32, i32, i32, i32], body);

  // __jswat_str_length(str:i32) -> i32  — len is at offset 4 in 12-byte header
  mod.addFunction('__jswat_str_length',
    binaryen.createType([i32]), i32, [],
    mod.if(mod.i32.eqz(mod.local.get(0, i32)), mod.i32.const(0),
      mod.i32.load(4, 0, mod.local.get(0, i32))));

  // __jswat_str_char_at(str:i32, idx:i32) -> i32
  // Returns the byte value at position idx; -1 if out of range.
  {
    const gstr = () => mod.local.get(0, i32);
    const gidx = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(gstr()), mod.return(mod.i32.const(-1))),
      mod.if(mod.i32.ge_u(gidx(), mod.i32.load(4, 0, gstr())), mod.return(mod.i32.const(-1))),
      mod.return(mod.i32.load8_u(0, 0,
        mod.i32.add(mod.i32.add(gstr(), mod.i32.const(12)), gidx()))),
    ], i32);
    mod.addFunction('__jswat_str_char_at', binaryen.createType([i32, i32]), i32, [], body);
  }

  // __jswat_str_concat(a:i32, b:i32) -> i32
  // params: a(0:i32), b(1:i32); locals: la(2:i32), lb(3:i32), total(4:i32), ptr(5:i32)
  {
    const ga  = () => mod.local.get(0, i32);
    const gb  = () => mod.local.get(1, i32);
    const gla = () => mod.local.get(2, i32);
    const glb = () => mod.local.get(3, i32);
    const gtotal = () => mod.local.get(4, i32);
    const gptr   = () => mod.local.get(5, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.if(mod.i32.eqz(ga()), mod.i32.const(0), mod.i32.load(4, 0, ga()), i32)),
      mod.local.set(3, mod.if(mod.i32.eqz(gb()), mod.i32.const(0), mod.i32.load(4, 0, gb()), i32)),
      mod.local.set(4, mod.i32.add(gla(), glb())),
      mod.local.set(5, mod.call('__jswat_alloc',
        [mod.i32.add(gtotal(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, gptr(), mod.i32.const(1)),   // rc = 1
      mod.i32.store(4, 0, gptr(), gtotal()),            // len at 4
      mod.i32.store(8, 0, gptr(), mod.i32.const(0)),   // hash at 8
      mod.if(mod.i32.gt_u(gla(), mod.i32.const(0)),
        mod.memory.copy(
          mod.i32.add(gptr(), mod.i32.const(12)),
          mod.i32.add(ga(), mod.i32.const(12)), gla())),
      mod.if(mod.i32.gt_u(glb(), mod.i32.const(0)),
        mod.memory.copy(
          mod.i32.add(mod.i32.add(gptr(), mod.i32.const(12)), gla()),
          mod.i32.add(gb(), mod.i32.const(12)), glb())),
      mod.return(gptr()),
    ], i32);
    mod.addFunction('__jswat_str_concat', binaryen.createType([i32, i32]), i32, [i32, i32, i32, i32], body);
  }

  // __jswat_str_slice(str:i32, start:i32, end:i32) -> i32
  // params: str(0:i32), start(1:i32), end(2:i32); locals: len(3:i32), slen(4:i32), ptr(5:i32)
  {
    const gstr   = () => mod.local.get(0, i32);
    const gstart = () => mod.local.get(1, i32);
    const gend   = () => mod.local.get(2, i32);
    const gstrlen = () => mod.local.get(3, i32);
    const gslen  = () => mod.local.get(4, i32);
    const gptr   = () => mod.local.get(5, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(gstr()), mod.return(mod.i32.const(0))),
      mod.local.set(3, mod.i32.load(4, 0, gstr())),    // strlen — len at offset 4
      // clamp start/end
      mod.if(mod.i32.lt_s(gstart(), mod.i32.const(0)),
        mod.local.set(1, mod.i32.const(0))),
      mod.if(mod.i32.gt_u(gstart(), gstrlen()),
        mod.local.set(1, gstrlen())),
      mod.if(mod.i32.lt_s(gend(), mod.i32.const(0)),
        mod.local.set(2, mod.i32.const(0))),
      mod.if(mod.i32.gt_u(gend(), gstrlen()),
        mod.local.set(2, gstrlen())),
      mod.if(mod.i32.le_u(gend(), gstart()), mod.return(mod.i32.const(0))),
      mod.local.set(4, mod.i32.sub(gend(), gstart())),  // slice length
      mod.local.set(5, mod.call('__jswat_alloc',
        [mod.i32.add(gslen(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, gptr(), mod.i32.const(1)),   // rc = 1
      mod.i32.store(4, 0, gptr(), gslen()),             // len at 4
      mod.i32.store(8, 0, gptr(), mod.i32.const(0)),   // hash at 8
      mod.memory.copy(
        mod.i32.add(gptr(), mod.i32.const(12)),
        mod.i32.add(mod.i32.add(gstr(), mod.i32.const(12)), gstart()),
        gslen()),
      mod.return(gptr()),
    ], i32);
    mod.addFunction('__jswat_str_slice', binaryen.createType([i32, i32, i32]), i32, [i32, i32, i32], body);
  }

  // __jswat_str_index_of(str:i32, needle:i32) -> i32  (returns -1 if not found)
  // params: str(0:i32), needle(1:i32); locals: slen(2:i32), nlen(3:i32), i(4:i32), j(5:i32)
  {
    const gstr    = () => mod.local.get(0, i32);
    const gneedle = () => mod.local.get(1, i32);
    const gslen   = () => mod.local.get(2, i32);
    const gnlen   = () => mod.local.get(3, i32);
    const gi      = () => mod.local.get(4, i32);
    const gj      = () => mod.local.get(5, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(gstr()), mod.return(mod.i32.const(-1))),
      mod.if(mod.i32.eqz(gneedle()), mod.return(mod.i32.const(-1))),
      mod.local.set(2, mod.i32.load(4, 0, gstr())),    // len at offset 4
      mod.local.set(3, mod.i32.load(4, 0, gneedle())), // len at offset 4
      mod.if(mod.i32.eqz(gnlen()), mod.return(mod.i32.const(0))),
      mod.local.set(4, mod.i32.const(0)),
      mod.block('search_done', [
        mod.loop('search_outer', mod.block(null, [
          // if i > slen - nlen: not found
          mod.br_if('search_done',
            mod.i32.gt_s(gi(), mod.i32.sub(gslen(), gnlen()))),
          // inner match loop
          mod.local.set(5, mod.i32.const(0)),
          mod.block('match_done', [
            mod.loop('match_inner', mod.block(null, [
              mod.br_if('match_done', mod.i32.ge_u(gj(), gnlen())),
              mod.if(
                mod.i32.ne(
                  mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gstr(), mod.i32.const(12)), mod.i32.add(gi(), gj()))),
                  mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gneedle(), mod.i32.const(12)), gj()))),
                mod.block(null, [mod.local.set(5, mod.i32.const(-1)), mod.br('match_done')], none)),
              mod.local.set(5, mod.i32.add(gj(), mod.i32.const(1))),
              mod.br('match_inner'),
            ], none)),
          ], none),
          // if j == nlen: found at i
          mod.if(mod.i32.eq(gj(), gnlen()), mod.return(gi())),
          mod.local.set(4, mod.i32.add(gi(), mod.i32.const(1))),
          mod.br('search_outer'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(-1)),
    ], i32);
    mod.addFunction('__jswat_str_index_of', binaryen.createType([i32, i32]), i32, [i32, i32, i32, i32], body);
  }

  // __jswat_str_starts_with(str:i32, prefix:i32) -> i32  (1=true, 0=false)
  // params: str(0:i32), prefix(1:i32); locals: slen(2:i32), plen(3:i32), i(4:i32)
  {
    const gstr   = () => mod.local.get(0, i32);
    const gprefix= () => mod.local.get(1, i32);
    const gslen  = () => mod.local.get(2, i32);
    const gplen  = () => mod.local.get(3, i32);
    const gi     = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(gstr()),    mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(gprefix()), mod.return(mod.i32.const(1))),  // empty prefix always matches
      mod.local.set(2, mod.i32.load(4, 0, gstr())),    // len at offset 4
      mod.local.set(3, mod.i32.load(4, 0, gprefix())), // len at offset 4
      mod.if(mod.i32.gt_u(gplen(), gslen()), mod.return(mod.i32.const(0))),
      mod.local.set(4, mod.i32.const(0)),
      mod.block('sw_done', [
        mod.loop('sw_loop', mod.block(null, [
          mod.br_if('sw_done', mod.i32.ge_u(gi(), gplen())),
          mod.if(
            mod.i32.ne(
              mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gstr(),    mod.i32.const(12)), gi())),
              mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gprefix(), mod.i32.const(12)), gi()))),
            mod.return(mod.i32.const(0))),
          mod.local.set(4, mod.i32.add(gi(), mod.i32.const(1))),
          mod.br('sw_loop'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(1)),
    ], i32);
    mod.addFunction('__jswat_str_starts_with', binaryen.createType([i32, i32]), i32, [i32, i32, i32], body);
  }

  // __jswat_str_ends_with(str:i32, suffix:i32) -> i32  (1=true, 0=false)
  // params: str(0:i32), suffix(1:i32); locals: slen(2:i32), sfxlen(3:i32), i(4:i32), soff(5:i32)
  {
    const gstr   = () => mod.local.get(0, i32);
    const gsuffix= () => mod.local.get(1, i32);
    const gslen  = () => mod.local.get(2, i32);
    const gsfxlen= () => mod.local.get(3, i32);
    const gi     = () => mod.local.get(4, i32);
    const gsoff  = () => mod.local.get(5, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(gstr()),    mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(gsuffix()), mod.return(mod.i32.const(1))),
      mod.local.set(2, mod.i32.load(4, 0, gstr())),    // len at offset 4
      mod.local.set(3, mod.i32.load(4, 0, gsuffix())), // len at offset 4
      mod.if(mod.i32.gt_u(gsfxlen(), gslen()), mod.return(mod.i32.const(0))),
      // soff = slen - sfxlen  (offset in str where suffix must start)
      mod.local.set(5, mod.i32.sub(gslen(), gsfxlen())),
      mod.local.set(4, mod.i32.const(0)),
      mod.block('ew_done', [
        mod.loop('ew_loop', mod.block(null, [
          mod.br_if('ew_done', mod.i32.ge_u(gi(), gsfxlen())),
          mod.if(
            mod.i32.ne(
              mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gstr(),    mod.i32.const(12)), mod.i32.add(gsoff(), gi()))),
              mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gsuffix(), mod.i32.const(12)), gi()))),
            mod.return(mod.i32.const(0))),
          mod.local.set(4, mod.i32.add(gi(), mod.i32.const(1))),
          mod.br('ew_loop'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(1)),
    ], i32);
    mod.addFunction('__jswat_str_ends_with', binaryen.createType([i32, i32]), i32, [i32, i32, i32, i32], body);
  }

  // __jswat_str_equals(a:i32, b:i32) -> i32  (1=equal, 0=not equal)
  // params: a(0:i32), b(1:i32); locals: la(2:i32), lb(3:i32), i(4:i32)
  {
    const ga  = () => mod.local.get(0, i32);
    const gb  = () => mod.local.get(1, i32);
    const gla = () => mod.local.get(2, i32);
    const glb = () => mod.local.get(3, i32);
    const gi  = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eq(ga(), gb()), mod.return(mod.i32.const(1))),  // same pointer (incl both null)
      mod.if(mod.i32.eqz(ga()), mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(gb()), mod.return(mod.i32.const(0))),
      mod.local.set(2, mod.i32.load(4, 0, ga())),  // len at offset 4
      mod.local.set(3, mod.i32.load(4, 0, gb())),  // len at offset 4
      mod.if(mod.i32.ne(gla(), glb()), mod.return(mod.i32.const(0))),
      mod.local.set(4, mod.i32.const(0)),
      mod.block('eq_done', [
        mod.loop('eq_loop', mod.block(null, [
          mod.br_if('eq_done', mod.i32.ge_u(gi(), gla())),
          mod.if(
            mod.i32.ne(
              mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(ga(), mod.i32.const(12)), gi())),
              mod.i32.load8_u(0, 0, mod.i32.add(mod.i32.add(gb(), mod.i32.const(12)), gi()))),
            mod.return(mod.i32.const(0))),
          mod.local.set(4, mod.i32.add(gi(), mod.i32.const(1))),
          mod.br('eq_loop'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(1)),
    ], i32);
    mod.addFunction('__jswat_str_equals', binaryen.createType([i32, i32]), i32, [i32, i32, i32], body);
  }
}

// ── std/collections ───────────────────────────────────────────────────────────
// Map node layout: [rc:4][next:4][key:8][value:12]  (alloc 16)
// Map header:      [rc:4][head:4][size:8]            (alloc 12)
// Set node layout: [rc:4][next:4][value:8]           (alloc 12)
// Set header:      [rc:4][head:4][size:8]            (alloc 12)
// Stack node:      [rc:4][next:4][value:8]           (alloc 12)
// Stack header:    [rc:4][head:4][size:8]            (alloc 12)
// Queue node:      [rc:4][next:4][value:8]           (alloc 12)
// Queue header:    [rc:4][head:4][tail:8][size:12]   (alloc 16)
// Deque node:      [rc:4][prev:4][next:8][value:12]  (alloc 16)
// Deque header:    [rc:4][head:4][tail:8][size:12]   (alloc 16)

/**
 * Build std/collections implementations.
 * @param {any} mod
 */
export function buildCollectionsFunctions(mod) {
  // ── Map ────────────────────────────────────────────────────────────────────

  // __jswat_map_new() -> i32
  {
    const getPtr = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.local.set(0, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(4, 0, getPtr(), mod.i32.const(0)),
      mod.i32.store(8, 0, getPtr(), mod.i32.const(0)),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_map_new', binaryen.createType([]), i32, [i32], body);
  }

  // __jswat_map_set(map:i32, key:i32, value:i32) -> void
  // params: map(0), key(1), value(2); locals: cur(3)
  {
    const getMap = () => mod.local.get(0, i32);
    const getKey = () => mod.local.get(1, i32);
    const getVal = () => mod.local.get(2, i32);
    const getCur = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getMap()), mod.return()),
      mod.local.set(3, mod.i32.load(4, 0, getMap())),
      mod.block('not_found', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('not_found', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getKey()),
            mod.block(null, [
              mod.i32.store(12, 0, getCur(), getVal()),
              mod.return(),
            ], none)
          ),
          mod.local.set(3, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      // allocate new node
      mod.local.set(3, mod.call('__alloc', [mod.i32.const(16)], i32)),
      mod.i32.store(4, 0, getCur(), mod.i32.load(4, 0, getMap())),   // node.next = map.head
      mod.i32.store(8, 0, getCur(), getKey()),
      mod.i32.store(12, 0, getCur(), getVal()),
      mod.i32.store(4, 0, getMap(), getCur()),                         // map.head = node
      mod.i32.store(8, 0, getMap(),
        mod.i32.add(mod.i32.load(8, 0, getMap()), mod.i32.const(1))), // size++
    ], none);
    mod.addFunction('__jswat_map_set',
      binaryen.createType([i32, i32, i32]), none, [i32], body);
  }

  // __jswat_map_get(map:i32, key:i32) -> i32
  // params: map(0), key(1); locals: cur(2)
  {
    const getMap = () => mod.local.get(0, i32);
    const getKey = () => mod.local.get(1, i32);
    const getCur = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getMap()), mod.return(mod.i32.const(0))),
      mod.local.set(2, mod.i32.load(4, 0, getMap())),
      mod.block('done', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('done', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getKey()),
            mod.return(mod.i32.load(12, 0, getCur()))
          ),
          mod.local.set(2, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(0)),
    ], i32);
    mod.addFunction('__jswat_map_get',
      binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // __jswat_map_has(map:i32, key:i32) -> i32
  // params: map(0), key(1); locals: cur(2)
  {
    const getMap = () => mod.local.get(0, i32);
    const getKey = () => mod.local.get(1, i32);
    const getCur = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getMap()), mod.return(mod.i32.const(0))),
      mod.local.set(2, mod.i32.load(4, 0, getMap())),
      mod.block('done', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('done', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getKey()),
            mod.return(mod.i32.const(1))
          ),
          mod.local.set(2, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(0)),
    ], i32);
    mod.addFunction('__jswat_map_has',
      binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // __jswat_map_delete(map:i32, key:i32) -> i32
  // params: map(0), key(1); locals: cur(2), prev(3)
  {
    const getMap  = () => mod.local.get(0, i32);
    const getKey  = () => mod.local.get(1, i32);
    const getCur  = () => mod.local.get(2, i32);
    const getPrev = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getMap()), mod.return(mod.i32.const(0))),
      mod.local.set(3, mod.i32.const(0)),
      mod.local.set(2, mod.i32.load(4, 0, getMap())),
      mod.block('done', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('done', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getKey()),
            mod.block(null, [
              mod.if(
                mod.i32.eqz(getPrev()),
                mod.i32.store(4, 0, getMap(), mod.i32.load(4, 0, getCur())),
                mod.i32.store(4, 0, getPrev(), mod.i32.load(4, 0, getCur()))
              ),
              mod.i32.store(8, 0, getMap(),
                mod.i32.sub(mod.i32.load(8, 0, getMap()), mod.i32.const(1))),
              mod.return(mod.i32.const(1)),
            ], none)
          ),
          mod.local.set(3, getCur()),
          mod.local.set(2, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(0)),
    ], i32);
    mod.addFunction('__jswat_map_delete',
      binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // __jswat_map_size(map:i32) -> i32
  {
    const getMap = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_map_size',
      binaryen.createType([i32]), i32, [],
      mod.if(mod.i32.eqz(getMap()), mod.i32.const(0), mod.i32.load(8, 0, getMap())));
  }

  // __jswat_map_clear(map:i32) -> void
  {
    const getMap = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getMap()), mod.return()),
      mod.i32.store(4, 0, getMap(), mod.i32.const(0)),
      mod.i32.store(8, 0, getMap(), mod.i32.const(0)),
    ], none);
    mod.addFunction('__jswat_map_clear', binaryen.createType([i32]), none, [], body);
  }

  // ── Set ────────────────────────────────────────────────────────────────────

  // __jswat_set_new() -> i32
  {
    const getPtr = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.local.set(0, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(4, 0, getPtr(), mod.i32.const(0)),
      mod.i32.store(8, 0, getPtr(), mod.i32.const(0)),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_set_new', binaryen.createType([]), i32, [i32], body);
  }

  // __jswat_set_add(set:i32, value:i32) -> void
  // params: set(0), value(1); locals: cur(2)
  {
    const getSet = () => mod.local.get(0, i32);
    const getVal = () => mod.local.get(1, i32);
    const getCur = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getSet()), mod.return()),
      mod.local.set(2, mod.i32.load(4, 0, getSet())),
      mod.block('not_found', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('not_found', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getVal()),
            mod.return()
          ),
          mod.local.set(2, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(4, 0, getCur(), mod.i32.load(4, 0, getSet())),
      mod.i32.store(8, 0, getCur(), getVal()),
      mod.i32.store(4, 0, getSet(), getCur()),
      mod.i32.store(8, 0, getSet(),
        mod.i32.add(mod.i32.load(8, 0, getSet()), mod.i32.const(1))),
    ], none);
    mod.addFunction('__jswat_set_add',
      binaryen.createType([i32, i32]), none, [i32], body);
  }

  // __jswat_set_has(set:i32, value:i32) -> i32
  // params: set(0), value(1); locals: cur(2)
  {
    const getSet = () => mod.local.get(0, i32);
    const getVal = () => mod.local.get(1, i32);
    const getCur = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getSet()), mod.return(mod.i32.const(0))),
      mod.local.set(2, mod.i32.load(4, 0, getSet())),
      mod.block('done', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('done', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getVal()),
            mod.return(mod.i32.const(1))
          ),
          mod.local.set(2, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(0)),
    ], i32);
    mod.addFunction('__jswat_set_has',
      binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // __jswat_set_delete(set:i32, value:i32) -> i32
  // params: set(0), value(1); locals: cur(2), prev(3)
  {
    const getSet  = () => mod.local.get(0, i32);
    const getVal  = () => mod.local.get(1, i32);
    const getCur  = () => mod.local.get(2, i32);
    const getPrev = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getSet()), mod.return(mod.i32.const(0))),
      mod.local.set(3, mod.i32.const(0)),
      mod.local.set(2, mod.i32.load(4, 0, getSet())),
      mod.block('done', [
        mod.loop('scan', mod.block(null, [
          mod.br_if('done', mod.i32.eqz(getCur())),
          mod.if(
            mod.i32.eq(mod.i32.load(8, 0, getCur()), getVal()),
            mod.block(null, [
              mod.if(
                mod.i32.eqz(getPrev()),
                mod.i32.store(4, 0, getSet(), mod.i32.load(4, 0, getCur())),
                mod.i32.store(4, 0, getPrev(), mod.i32.load(4, 0, getCur()))
              ),
              mod.i32.store(8, 0, getSet(),
                mod.i32.sub(mod.i32.load(8, 0, getSet()), mod.i32.const(1))),
              mod.return(mod.i32.const(1)),
            ], none)
          ),
          mod.local.set(3, getCur()),
          mod.local.set(2, mod.i32.load(4, 0, getCur())),
          mod.br('scan'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(0)),
    ], i32);
    mod.addFunction('__jswat_set_delete',
      binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // __jswat_set_size(set:i32) -> i32
  {
    const getSet = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_set_size',
      binaryen.createType([i32]), i32, [],
      mod.if(mod.i32.eqz(getSet()), mod.i32.const(0), mod.i32.load(8, 0, getSet())));
  }

  // __jswat_set_clear(set:i32) -> void
  {
    const getSet = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getSet()), mod.return()),
      mod.i32.store(4, 0, getSet(), mod.i32.const(0)),
      mod.i32.store(8, 0, getSet(), mod.i32.const(0)),
    ], none);
    mod.addFunction('__jswat_set_clear', binaryen.createType([i32]), none, [], body);
  }

  // ── Stack ──────────────────────────────────────────────────────────────────

  // __jswat_stack_new() -> i32
  {
    const getPtr = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.local.set(0, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(4, 0, getPtr(), mod.i32.const(0)),
      mod.i32.store(8, 0, getPtr(), mod.i32.const(0)),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_stack_new', binaryen.createType([]), i32, [i32], body);
  }

  // __jswat_stack_push(stack:i32, value:i32) -> void
  // params: stack(0), value(1); locals: node(2)
  {
    const getStack = () => mod.local.get(0, i32);
    const getVal   = () => mod.local.get(1, i32);
    const getNode  = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getStack()), mod.return()),
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(4, 0, getNode(), mod.i32.load(4, 0, getStack())),
      mod.i32.store(8, 0, getNode(), getVal()),
      mod.i32.store(4, 0, getStack(), getNode()),
      mod.i32.store(8, 0, getStack(),
        mod.i32.add(mod.i32.load(8, 0, getStack()), mod.i32.const(1))),
    ], none);
    mod.addFunction('__jswat_stack_push',
      binaryen.createType([i32, i32]), none, [i32], body);
  }

  // __jswat_stack_pop(stack:i32) -> i32
  // params: stack(0); locals: node(1)
  {
    const getStack = () => mod.local.get(0, i32);
    const getNode  = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getStack()), mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getStack())),
      mod.if(mod.i32.eqz(getNode()), mod.return(mod.i32.const(0))),
      mod.i32.store(4, 0, getStack(), mod.i32.load(4, 0, getNode())),
      mod.i32.store(8, 0, getStack(),
        mod.i32.sub(mod.i32.load(8, 0, getStack()), mod.i32.const(1))),
      mod.return(mod.i32.load(8, 0, getNode())),
    ], i32);
    mod.addFunction('__jswat_stack_pop',
      binaryen.createType([i32]), i32, [i32], body);
  }

  // __jswat_stack_size(stack:i32) -> i32
  {
    const getStack = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_stack_size',
      binaryen.createType([i32]), i32, [],
      mod.if(mod.i32.eqz(getStack()), mod.i32.const(0), mod.i32.load(8, 0, getStack())));
  }

  // __jswat_stack_peek(stack:i32) -> i32
  {
    const getStack = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getStack()), mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(mod.i32.load(4, 0, getStack())), mod.return(mod.i32.const(0))),
      mod.return(mod.i32.load(8, 0, mod.i32.load(4, 0, getStack()))),
    ], i32);
    mod.addFunction('__jswat_stack_peek', binaryen.createType([i32]), i32, [], body);
  }

  // __jswat_stack_empty(stack:i32) -> i32
  {
    const getStack = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_stack_empty',
      binaryen.createType([i32]), i32, [],
      mod.if(
        mod.i32.eqz(getStack()),
        mod.i32.const(1),
        mod.i32.eqz(mod.i32.load(8, 0, getStack()))));
  }

  // ── Queue ──────────────────────────────────────────────────────────────────

  // __jswat_queue_new() -> i32
  {
    const getPtr = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.local.set(0, mod.call('__alloc', [mod.i32.const(16)], i32)),
      mod.i32.store(4,  0, getPtr(), mod.i32.const(0)),
      mod.i32.store(8,  0, getPtr(), mod.i32.const(0)),
      mod.i32.store(12, 0, getPtr(), mod.i32.const(0)),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_queue_new', binaryen.createType([]), i32, [i32], body);
  }

  // __jswat_queue_push(queue:i32, value:i32) -> void
  // params: queue(0), value(1); locals: node(2)
  {
    const getQ    = () => mod.local.get(0, i32);
    const getVal  = () => mod.local.get(1, i32);
    const getNode = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getQ()), mod.return()),
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(4, 0, getNode(), mod.i32.const(0)),   // node.next = null
      mod.i32.store(8, 0, getNode(), getVal()),
      mod.if(
        mod.i32.eqz(mod.i32.load(8, 0, getQ())),         // if tail == null
        mod.block(null, [
          mod.i32.store(4, 0, getQ(), getNode()),          // head = node
          mod.i32.store(8, 0, getQ(), getNode()),          // tail = node
        ], none),
        mod.block(null, [
          mod.i32.store(4, 0, mod.i32.load(8, 0, getQ()), getNode()),  // old_tail.next = node
          mod.i32.store(8, 0, getQ(), getNode()),          // tail = node
        ], none)
      ),
      mod.i32.store(12, 0, getQ(),
        mod.i32.add(mod.i32.load(12, 0, getQ()), mod.i32.const(1))),
    ], none);
    mod.addFunction('__jswat_queue_push',
      binaryen.createType([i32, i32]), none, [i32], body);
  }

  // __jswat_queue_pop(queue:i32) -> i32
  // params: queue(0); locals: node(1)
  {
    const getQ    = () => mod.local.get(0, i32);
    const getNode = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getQ()), mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getQ())),       // node = head
      mod.if(mod.i32.eqz(getNode()), mod.return(mod.i32.const(0))),
      mod.i32.store(4, 0, getQ(), mod.i32.load(4, 0, getNode())),  // head = node.next
      mod.if(
        mod.i32.eqz(mod.i32.load(4, 0, getQ())),          // if new head == null
        mod.i32.store(8, 0, getQ(), mod.i32.const(0))      // tail = null
      ),
      mod.i32.store(12, 0, getQ(),
        mod.i32.sub(mod.i32.load(12, 0, getQ()), mod.i32.const(1))),
      mod.return(mod.i32.load(8, 0, getNode())),
    ], i32);
    mod.addFunction('__jswat_queue_pop',
      binaryen.createType([i32]), i32, [i32], body);
  }

  // __jswat_queue_size(queue:i32) -> i32
  {
    const getQ = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_queue_size',
      binaryen.createType([i32]), i32, [],
      mod.if(mod.i32.eqz(getQ()), mod.i32.const(0), mod.i32.load(12, 0, getQ())));
  }

  // __jswat_queue_peek(queue:i32) -> i32
  {
    const getQ = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getQ()), mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(mod.i32.load(4, 0, getQ())), mod.return(mod.i32.const(0))),
      mod.return(mod.i32.load(8, 0, mod.i32.load(4, 0, getQ()))),
    ], i32);
    mod.addFunction('__jswat_queue_peek', binaryen.createType([i32]), i32, [], body);
  }

  // __jswat_queue_empty(queue:i32) -> i32
  {
    const getQ = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_queue_empty',
      binaryen.createType([i32]), i32, [],
      mod.if(
        mod.i32.eqz(getQ()),
        mod.i32.const(1),
        mod.i32.eqz(mod.i32.load(12, 0, getQ()))));
  }

  // ── Deque ──────────────────────────────────────────────────────────────────

  // __jswat_deque_new() -> i32
  {
    const getPtr = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.local.set(0, mod.call('__alloc', [mod.i32.const(16)], i32)),
      mod.i32.store(4,  0, getPtr(), mod.i32.const(0)),
      mod.i32.store(8,  0, getPtr(), mod.i32.const(0)),
      mod.i32.store(12, 0, getPtr(), mod.i32.const(0)),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_deque_new', binaryen.createType([]), i32, [i32], body);
  }

  // __jswat_deque_push_front(deque:i32, value:i32) -> void
  // params: deque(0), value(1); locals: node(2)
  {
    const getD    = () => mod.local.get(0, i32);
    const getVal  = () => mod.local.get(1, i32);
    const getNode = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getD()), mod.return()),
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(16)], i32)),
      mod.i32.store(4,  0, getNode(), mod.i32.const(0)),              // node.prev = null
      mod.i32.store(8,  0, getNode(), mod.i32.load(4, 0, getD())),   // node.next = old head
      mod.i32.store(12, 0, getNode(), getVal()),
      mod.if(
        mod.i32.eqz(mod.i32.load(4, 0, getD())),                     // if was empty
        mod.i32.store(8, 0, getD(), getNode()),                        // tail = node
        mod.i32.store(4, 0, mod.i32.load(4, 0, getD()), getNode())   // old_head.prev = node
      ),
      mod.i32.store(4,  0, getD(), getNode()),                        // head = node
      mod.i32.store(12, 0, getD(),
        mod.i32.add(mod.i32.load(12, 0, getD()), mod.i32.const(1))),
    ], none);
    mod.addFunction('__jswat_deque_push_front',
      binaryen.createType([i32, i32]), none, [i32], body);
  }

  // __jswat_deque_push_back(deque:i32, value:i32) -> void
  // params: deque(0), value(1); locals: node(2)
  {
    const getD    = () => mod.local.get(0, i32);
    const getVal  = () => mod.local.get(1, i32);
    const getNode = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getD()), mod.return()),
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(16)], i32)),
      mod.i32.store(4,  0, getNode(), mod.i32.load(8, 0, getD())),   // node.prev = old tail
      mod.i32.store(8,  0, getNode(), mod.i32.const(0)),              // node.next = null
      mod.i32.store(12, 0, getNode(), getVal()),
      mod.if(
        mod.i32.eqz(mod.i32.load(8, 0, getD())),                     // if was empty
        mod.i32.store(4, 0, getD(), getNode()),                        // head = node
        mod.i32.store(8, 0, mod.i32.load(8, 0, getD()), getNode())   // old_tail.next = node
      ),
      mod.i32.store(8,  0, getD(), getNode()),                        // tail = node
      mod.i32.store(12, 0, getD(),
        mod.i32.add(mod.i32.load(12, 0, getD()), mod.i32.const(1))),
    ], none);
    mod.addFunction('__jswat_deque_push_back',
      binaryen.createType([i32, i32]), none, [i32], body);
  }

  // __jswat_deque_pop_front(deque:i32) -> i32
  // params: deque(0); locals: node(1)
  {
    const getD    = () => mod.local.get(0, i32);
    const getNode = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getD()),   mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getD())),
      mod.if(mod.i32.eqz(getNode()), mod.return(mod.i32.const(0))),
      mod.i32.store(4, 0, getD(), mod.i32.load(8, 0, getNode())),     // head = node.next
      mod.if(
        mod.i32.eqz(mod.i32.load(4, 0, getD())),
        mod.i32.store(8, 0, getD(), mod.i32.const(0)),                 // tail = null
        mod.i32.store(4, 0, mod.i32.load(4, 0, getD()), mod.i32.const(0))  // new_head.prev=0
      ),
      mod.i32.store(12, 0, getD(),
        mod.i32.sub(mod.i32.load(12, 0, getD()), mod.i32.const(1))),
      mod.return(mod.i32.load(12, 0, getNode())),
    ], i32);
    mod.addFunction('__jswat_deque_pop_front',
      binaryen.createType([i32]), i32, [i32], body);
  }

  // __jswat_deque_pop_back(deque:i32) -> i32
  // params: deque(0); locals: node(1)
  {
    const getD    = () => mod.local.get(0, i32);
    const getNode = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getD()),   mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(8, 0, getD())),                   // node = tail
      mod.if(mod.i32.eqz(getNode()), mod.return(mod.i32.const(0))),
      mod.i32.store(8, 0, getD(), mod.i32.load(4, 0, getNode())),     // tail = node.prev
      mod.if(
        mod.i32.eqz(mod.i32.load(8, 0, getD())),
        mod.i32.store(4, 0, getD(), mod.i32.const(0)),                 // head = null
        mod.i32.store(8, 0, mod.i32.load(8, 0, getD()), mod.i32.const(0))  // new_tail.next=0
      ),
      mod.i32.store(12, 0, getD(),
        mod.i32.sub(mod.i32.load(12, 0, getD()), mod.i32.const(1))),
      mod.return(mod.i32.load(12, 0, getNode())),
    ], i32);
    mod.addFunction('__jswat_deque_pop_back',
      binaryen.createType([i32]), i32, [i32], body);
  }

  // __jswat_deque_size(deque:i32) -> i32
  {
    const getD = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_deque_size',
      binaryen.createType([i32]), i32, [],
      mod.if(mod.i32.eqz(getD()), mod.i32.const(0), mod.i32.load(12, 0, getD())));
  }

  // __jswat_deque_peek_front(deque:i32) -> i32
  {
    const getD = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getD()), mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(mod.i32.load(4, 0, getD())), mod.return(mod.i32.const(0))),
      mod.return(mod.i32.load(12, 0, mod.i32.load(4, 0, getD()))),
    ], i32);
    mod.addFunction('__jswat_deque_peek_front', binaryen.createType([i32]), i32, [], body);
  }

  // __jswat_deque_peek_back(deque:i32) -> i32
  {
    const getD = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getD()), mod.return(mod.i32.const(0))),
      mod.if(mod.i32.eqz(mod.i32.load(8, 0, getD())), mod.return(mod.i32.const(0))),
      mod.return(mod.i32.load(12, 0, mod.i32.load(8, 0, getD()))),
    ], i32);
    mod.addFunction('__jswat_deque_peek_back', binaryen.createType([i32]), i32, [], body);
  }

  // __jswat_deque_empty(deque:i32) -> i32
  {
    const getD = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_deque_empty',
      binaryen.createType([i32]), i32, [],
      mod.if(
        mod.i32.eqz(getD()),
        mod.i32.const(1),
        mod.i32.eqz(mod.i32.load(12, 0, getD()))));
  }
}

// ── std/io ────────────────────────────────────────────────────────────────────

/**
 * Build std/io implementations backed by WASI fd_write / fd_read.
 * @param {any} mod
 * @param {number} ioBase  scratch memory base address
 */
export function buildIoFunctions(mod, ioBase) {
  // __jswat_write(fd:i32, str:i32) -> void
  // params: fd(0), str(1); locals: len(2), ptr(3)
  {
    const getFd  = () => mod.local.get(0, i32);
    const getStr = () => mod.local.get(1, i32);
    const getLen = () => mod.local.get(2, i32);
    const getPtr = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.i32.load(4, 0, getStr())),            // len at offset 4
      mod.local.set(3, mod.i32.add(getStr(), mod.i32.const(12))), // bytes at offset 12
      mod.i32.store(0, 0, mod.i32.const(ioBase),     getPtr()),
      mod.i32.store(0, 0, mod.i32.const(ioBase + 4), getLen()),
      mod.drop(mod.call('fd_write', [
        getFd(), mod.i32.const(ioBase), mod.i32.const(1), mod.i32.const(ioBase + 8),
      ], i32)),
    ], none);
    mod.addFunction('__jswat_write',
      binaryen.createType([i32, i32]), none, [i32, i32], body);
  }

  // __jswat_write_line(fd:i32, str:i32) -> void
  // params: fd(0), str(1); locals: len(2), ptr(3)
  {
    const getFd  = () => mod.local.get(0, i32);
    const getStr = () => mod.local.get(1, i32);
    const getLen = () => mod.local.get(2, i32);
    const getPtr = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.i32.load(4, 0, getStr())),            // len at offset 4
      mod.local.set(3, mod.i32.add(getStr(), mod.i32.const(12))), // bytes at offset 12
      mod.i32.store(0, 0, mod.i32.const(ioBase),      getPtr()),
      mod.i32.store(0, 0, mod.i32.const(ioBase + 4),  getLen()),
      mod.i32.store(0, 0, mod.i32.const(ioBase + 8),  mod.i32.const(ioBase + 32)),
      mod.i32.store(0, 0, mod.i32.const(ioBase + 12), mod.i32.const(1)),
      mod.i32.store8(0, 0, mod.i32.const(ioBase + 32), mod.i32.const(10)), // '\n'
      mod.drop(mod.call('fd_write', [
        getFd(), mod.i32.const(ioBase), mod.i32.const(2), mod.i32.const(ioBase + 16),
      ], i32)),
    ], none);
    mod.addFunction('__jswat_write_line',
      binaryen.createType([i32, i32]), none, [i32, i32], body);
  }

  // __jswat_console_log(arg0:i32) -> void
  mod.addFunction('__jswat_console_log',
    binaryen.createType([i32]), none, [],
    mod.call('__jswat_write_line', [mod.i32.const(1), mod.local.get(0, i32)], none));

  // __jswat_console_error(arg0:i32) -> void
  mod.addFunction('__jswat_console_error',
    binaryen.createType([i32]), none, [],
    mod.call('__jswat_write_line', [mod.i32.const(2), mod.local.get(0, i32)], none));

  // __jswat_stdout_write(arg0:i32) -> void
  mod.addFunction('__jswat_stdout_write',
    binaryen.createType([i32]), none, [],
    mod.call('__jswat_write', [mod.i32.const(1), mod.local.get(0, i32)], none));

  // __jswat_stdout_writeln(arg0:i32) -> void
  mod.addFunction('__jswat_stdout_writeln',
    binaryen.createType([i32]), none, [],
    mod.call('__jswat_write_line', [mod.i32.const(1), mod.local.get(0, i32)], none));

  // __jswat_stderr_write(arg0:i32) -> void
  mod.addFunction('__jswat_stderr_write',
    binaryen.createType([i32]), none, [],
    mod.call('__jswat_write', [mod.i32.const(2), mod.local.get(0, i32)], none));

  // __jswat_stdin_read(size:i32) -> i32
  // params: size(0); locals: buf(1), nread(2), str(3)
  {
    const getSz    = () => mod.local.get(0, i32);
    const getBuf   = () => mod.local.get(1, i32);
    const getNread = () => mod.local.get(2, i32);
    const getStr   = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.call('__jswat_alloc_bytes', [getSz(), mod.i32.const(0)], i32)),
      mod.i32.store(0, 0, mod.i32.const(ioBase + 16), getBuf()),
      mod.i32.store(0, 0, mod.i32.const(ioBase + 20), getSz()),
      mod.drop(mod.call('fd_read', [
        mod.i32.const(0), mod.i32.const(ioBase + 16), mod.i32.const(1),
        mod.i32.const(ioBase + 24),
      ], i32)),
      mod.local.set(2, mod.i32.load(0, 0, mod.i32.const(ioBase + 24))),
      mod.if(mod.i32.eqz(getNread()), mod.block(null, [
        mod.call('__jswat_free_bytes', [getBuf(), getSz()], none),
        mod.return(mod.i32.const(0)),
      ], none)),
      // Allocate str with 12-byte header: [rc:4][len:4][hash:4][bytes...]
      mod.local.set(3, mod.call('__jswat_alloc',
        [mod.i32.add(getNread(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, getStr(), mod.i32.const(1)),   // rc = 1
      mod.i32.store(4, 0, getStr(), getNread()),          // len at 4
      mod.i32.store(8, 0, getStr(), mod.i32.const(0)),   // hash at 8
      mod.memory.copy(mod.i32.add(getStr(), mod.i32.const(12)), getBuf(), getNread()),
      mod.call('__jswat_free_bytes', [getBuf(), getSz()], none),
      mod.return(getStr()),
    ], i32);
    mod.addFunction('__jswat_stdin_read',
      binaryen.createType([i32]), i32, [i32, i32, i32], body);
  }

  // __jswat_stdin_read_line() -> i32
  // locals: buf(0), total(1), nread(2), str(3), ch(4)
  {
    const getBuf   = () => mod.local.get(0, i32);
    const getTotal = () => mod.local.get(1, i32);
    const getNread = () => mod.local.get(2, i32);
    const getStr   = () => mod.local.get(3, i32);
    const getCh    = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.local.set(0, mod.call('__jswat_alloc_bytes', [mod.i32.const(1024), mod.i32.const(0)], i32)),
      mod.local.set(1, mod.i32.const(0)),
      mod.block('done', [
        mod.loop('read', mod.block(null, [
          mod.i32.store(0, 0, mod.i32.const(ioBase + 16),
            mod.i32.add(getBuf(), getTotal())),
          mod.i32.store(0, 0, mod.i32.const(ioBase + 20), mod.i32.const(1)),
          mod.drop(mod.call('fd_read', [
            mod.i32.const(0), mod.i32.const(ioBase + 16), mod.i32.const(1),
            mod.i32.const(ioBase + 24),
          ], i32)),
          mod.local.set(2, mod.i32.load(0, 0, mod.i32.const(ioBase + 24))),
          mod.br_if('done', mod.i32.eqz(getNread())),
          mod.local.set(4, mod.i32.load8_u(0, 0, mod.i32.add(getBuf(), getTotal()))),
          mod.br_if('done', mod.i32.eq(getCh(), mod.i32.const(10))),  // '\n'
          mod.local.set(1, mod.i32.add(getTotal(), mod.i32.const(1))),
          mod.br_if('done', mod.i32.ge_u(getTotal(), mod.i32.const(1024))),
          mod.br('read'),
        ], none)),
      ], none),
      mod.if(mod.i32.eqz(getTotal()), mod.block(null, [
        mod.call('__jswat_free_bytes', [getBuf(), mod.i32.const(1024)], none),
        mod.return(mod.i32.const(0)),
      ], none)),
      // Allocate str with 12-byte header: [rc:4][len:4][hash:4][bytes...]
      mod.local.set(3, mod.call('__jswat_alloc',
        [mod.i32.add(getTotal(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, getStr(), mod.i32.const(1)),   // rc = 1
      mod.i32.store(4, 0, getStr(), getTotal()),          // len at 4
      mod.i32.store(8, 0, getStr(), mod.i32.const(0)),   // hash at 8
      mod.memory.copy(mod.i32.add(getStr(), mod.i32.const(12)), getBuf(), getTotal()),
      mod.call('__jswat_free_bytes', [getBuf(), mod.i32.const(1024)], none),
      mod.return(getStr()),
    ], i32);
    mod.addFunction('__jswat_stdin_read_line',
      binaryen.createType([]), i32, [i32, i32, i32, i32, i32], body);
  }

  // __jswat_stdin_read_all() -> i32
  // locals: buf(0), cap(1), total(2), nread(3), newCap(4), str(5)
  {
    const getBuf    = () => mod.local.get(0, i32);
    const getCap    = () => mod.local.get(1, i32);
    const getTotal  = () => mod.local.get(2, i32);
    const getNread  = () => mod.local.get(3, i32);
    const getNewCap = () => mod.local.get(4, i32);
    const getStr    = () => mod.local.get(5, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.i32.const(1024)),
      mod.local.set(0, mod.call('__jswat_alloc_bytes', [mod.i32.const(1024), mod.i32.const(0)], i32)),
      mod.local.set(2, mod.i32.const(0)),
      mod.block('done', [
        mod.loop('read', mod.block(null, [
          mod.if(
            mod.i32.eq(getTotal(), getCap()),
            mod.block(null, [
              mod.local.set(4, mod.i32.mul(getCap(), mod.i32.const(2))),
              mod.local.set(0,
                mod.call('__jswat_realloc', [getBuf(), getCap(), getNewCap()], i32)),
              mod.local.set(1, getNewCap()),
            ], none)
          ),
          mod.i32.store(0, 0, mod.i32.const(ioBase + 16),
            mod.i32.add(getBuf(), getTotal())),
          mod.i32.store(0, 0, mod.i32.const(ioBase + 20),
            mod.i32.sub(getCap(), getTotal())),
          mod.drop(mod.call('fd_read', [
            mod.i32.const(0), mod.i32.const(ioBase + 16), mod.i32.const(1),
            mod.i32.const(ioBase + 24),
          ], i32)),
          mod.local.set(3, mod.i32.load(0, 0, mod.i32.const(ioBase + 24))),
          mod.br_if('done', mod.i32.eqz(getNread())),
          mod.local.set(2, mod.i32.add(getTotal(), getNread())),
          mod.br('read'),
        ], none)),
      ], none),
      mod.if(mod.i32.eqz(getTotal()), mod.block(null, [
        mod.call('__jswat_free_bytes', [getBuf(), getCap()], none),
        mod.return(mod.i32.const(0)),
      ], none)),
      // Allocate str with 12-byte header: [rc:4][len:4][hash:4][bytes...]
      mod.local.set(5, mod.call('__jswat_alloc',
        [mod.i32.add(getTotal(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, getStr(), mod.i32.const(1)),   // rc = 1
      mod.i32.store(4, 0, getStr(), getTotal()),          // len at 4
      mod.i32.store(8, 0, getStr(), mod.i32.const(0)),   // hash at 8
      mod.memory.copy(mod.i32.add(getStr(), mod.i32.const(12)), getBuf(), getTotal()),
      mod.call('__jswat_free_bytes', [getBuf(), getCap()], none),
      mod.return(getStr()),
    ], i32);
    mod.addFunction('__jswat_stdin_read_all',
      binaryen.createType([]), i32,
      [i32, i32, i32, i32, i32, i32], body);
  }
}

// ── std/fs ────────────────────────────────────────────────────────────────────

/**
 * Build std/fs implementations backed by WASI.
 * @param {any} mod
 * @param {number} fsBase  scratch memory base address for fs operations
 */
export function buildFsFunctions(mod, fsBase) {
  // Helper: call path_open with given oflags/fdflags, store fd at fsBase
  // Returns the error code (0 = success)
  function callPathOpen(getPath, oflags, fdflags) {
    return mod.call('path_open', [
      mod.i32.const(3),
      mod.i32.const(0),
      mod.i32.add(getPath(), mod.i32.const(12)),  // bytes at offset 12
      mod.i32.load(4, 0, getPath()),               // len at offset 4
      mod.i32.const(oflags),
      mod.i64.const(511, 0),
      mod.i64.const(511, 0),
      mod.i32.const(fdflags),
      mod.i32.const(fsBase),
    ], i32);
  }

  // __jswat_fs_read(path:i32) -> i32
  // params: path(0); locals: fd(1), buf(2), nread(3), str(4)
  {
    const getPath  = () => mod.local.get(0, i32);
    const getFd    = () => mod.local.get(1, i32);
    const getBuf   = () => mod.local.get(2, i32);
    const getNread = () => mod.local.get(3, i32);
    const getStr   = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.if(
        mod.i32.ne(callPathOpen(getPath, 0, 0), mod.i32.const(0)),
        mod.return(mod.i32.const(0))
      ),
      mod.local.set(1, mod.i32.load(0, 0, mod.i32.const(fsBase))),
      mod.local.set(2, mod.call('__jswat_alloc_bytes', [mod.i32.const(4096), mod.i32.const(0)], i32)),
      mod.i32.store(0, 0, mod.i32.const(fsBase + 4), getBuf()),
      mod.i32.store(0, 0, mod.i32.const(fsBase + 8), mod.i32.const(4096)),
      mod.drop(mod.call('fd_read', [
        getFd(), mod.i32.const(fsBase + 4), mod.i32.const(1), mod.i32.const(fsBase + 12),
      ], i32)),
      mod.local.set(3, mod.i32.load(0, 0, mod.i32.const(fsBase + 12))),
      mod.drop(mod.call('fd_close', [getFd()], i32)),
      mod.if(mod.i32.eqz(getNread()), mod.return(mod.i32.const(0))),
      mod.local.set(4, mod.call('__jswat_alloc',
        [mod.i32.add(getNread(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, getStr(), mod.i32.const(1)),   // rc = 1
      mod.i32.store(4, 0, getStr(), getNread()),          // len at 4
      mod.i32.store(8, 0, getStr(), mod.i32.const(0)),   // hash at 8
      mod.memory.copy(mod.i32.add(getStr(), mod.i32.const(12)), getBuf(), getNread()),
      mod.call('__jswat_free_bytes', [getBuf(), mod.i32.const(4096)], none),
      mod.return(getStr()),
    ], i32);
    mod.addFunction('__jswat_fs_read',
      binaryen.createType([i32]), i32, [i32, i32, i32, i32], body);
  }

  // __jswat_fs_write(path:i32, content:i32) -> i32
  // params: path(0), content(1); locals: fd(2)
  {
    const getPath    = () => mod.local.get(0, i32);
    const getContent = () => mod.local.get(1, i32);
    const getFd      = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(
        mod.i32.ne(callPathOpen(getPath, 9, 0), mod.i32.const(0)),  // oflags=9: CREAT|TRUNC
        mod.return(mod.i32.const(0))
      ),
      mod.local.set(2, mod.i32.load(0, 0, mod.i32.const(fsBase))),
      mod.i32.store(0, 0, mod.i32.const(fsBase + 4),
        mod.i32.add(getContent(), mod.i32.const(12))),  // bytes at offset 12
      mod.i32.store(0, 0, mod.i32.const(fsBase + 8),
        mod.i32.load(4, 0, getContent())),               // len at offset 4
      mod.drop(mod.call('fd_write', [
        getFd(), mod.i32.const(fsBase + 4), mod.i32.const(1), mod.i32.const(fsBase + 12),
      ], i32)),
      mod.drop(mod.call('fd_close', [getFd()], i32)),
      mod.return(mod.i32.const(1)),
    ], i32);
    mod.addFunction('__jswat_fs_write',
      binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // __jswat_fs_append(path:i32, content:i32) -> i32
  // params: path(0), content(1); locals: fd(2)
  {
    const getPath    = () => mod.local.get(0, i32);
    const getContent = () => mod.local.get(1, i32);
    const getFd      = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.if(
        mod.i32.ne(callPathOpen(getPath, 1, 1), mod.i32.const(0)),  // oflags=1: CREAT; fdflags=1: APPEND
        mod.return(mod.i32.const(0))
      ),
      mod.local.set(2, mod.i32.load(0, 0, mod.i32.const(fsBase))),
      mod.i32.store(0, 0, mod.i32.const(fsBase + 4),
        mod.i32.add(getContent(), mod.i32.const(12))),  // bytes at offset 12
      mod.i32.store(0, 0, mod.i32.const(fsBase + 8),
        mod.i32.load(4, 0, getContent())),               // len at offset 4
      mod.drop(mod.call('fd_write', [
        getFd(), mod.i32.const(fsBase + 4), mod.i32.const(1), mod.i32.const(fsBase + 12),
      ], i32)),
      mod.drop(mod.call('fd_close', [getFd()], i32)),
      mod.return(mod.i32.const(1)),
    ], i32);
    mod.addFunction('__jswat_fs_append',
      binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // __jswat_fs_exists(path:i32) -> i32
  {
    const getPath = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_fs_exists',
      binaryen.createType([i32]), i32, [],
      mod.return(mod.i32.eqz(mod.call('path_filestat_get', [
        mod.i32.const(3),
        mod.i32.const(0),
        mod.i32.add(getPath(), mod.i32.const(12)),  // bytes at offset 12
        mod.i32.load(4, 0, getPath()),               // len at offset 4
        mod.i32.const(fsBase + 32),
      ], i32))));
  }

  // __jswat_fs_delete(path:i32) -> i32
  {
    const getPath = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_fs_delete',
      binaryen.createType([i32]), i32, [],
      mod.return(mod.i32.eqz(mod.call('path_unlink_file', [
        mod.i32.const(3),
        mod.i32.add(getPath(), mod.i32.const(12)),  // bytes at offset 12
        mod.i32.load(4, 0, getPath()),               // len at offset 4
      ], i32))));
  }

  // __jswat_fs_mkdir(path:i32) -> i32
  {
    const getPath = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_fs_mkdir',
      binaryen.createType([i32]), i32, [],
      mod.return(mod.i32.eqz(mod.call('path_create_directory', [
        mod.i32.const(3),
        mod.i32.add(getPath(), mod.i32.const(12)),  // bytes at offset 12
        mod.i32.load(4, 0, getPath()),               // len at offset 4
      ], i32))));
  }

  // __jswat_fs_readdir(path:i32) -> i32  (stub: returns 0)
  mod.addFunction('__jswat_fs_readdir',
    binaryen.createType([i32]), i32, [],
    mod.return(mod.i32.const(0)));
}

// ── std/clock ─────────────────────────────────────────────────────────────────

/**
 * Build std/clock implementations backed by WASI clock_time_get.
 * @param {any} mod
 * @param {number} clockBase  scratch memory base for storing clock results
 */
export function buildClockFunctions(mod, clockBase) {
  // __jswat_clock_now() -> i32   (milliseconds, wall clock)
  {
    const body = mod.block(null, [
      mod.drop(mod.call('clock_time_get', [
        mod.i32.const(0),          // CLOCK_REALTIME
        mod.i64.const(1000000, 0), // precision (1ms)
        mod.i32.const(clockBase),
      ], i32)),
      mod.return(mod.i32.wrap(mod.i64.div_u(
        mod.i64.load(0, 0, mod.i32.const(clockBase)),
        mod.i64.const(1000000, 0)))),
    ], i32);
    mod.addFunction('__jswat_clock_now', binaryen.createType([]), i32, [], body);
  }

  // __jswat_clock_monotonic() -> i32  (nanoseconds, truncated to i32)
  {
    const body = mod.block(null, [
      mod.drop(mod.call('clock_time_get', [
        mod.i32.const(1),       // CLOCK_MONOTONIC
        mod.i64.const(1, 0),    // precision (1ns)
        mod.i32.const(clockBase),
      ], i32)),
      mod.return(mod.i32.wrap(mod.i64.load(0, 0, mod.i32.const(clockBase)))),
    ], i32);
    mod.addFunction('__jswat_clock_monotonic', binaryen.createType([]), i32, [], body);
  }

  // __jswat_clock_sleep(ms:i32) -> void
  // params: ms(0); locals: end(1)
  {
    const getMs  = () => mod.local.get(0, i32);
    const getEnd = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.i32.add(
        mod.i32.mul(getMs(), mod.i32.const(1000000)),
        mod.call('__jswat_clock_monotonic', [], i32)
      )),
      mod.block('done', [
        mod.loop('spin', mod.block(null, [
          mod.if(
            mod.i32.lt_u(mod.call('__jswat_clock_monotonic', [], i32), getEnd()),
            mod.block(null, [
              mod.drop(mod.call('sched_yield', [], i32)),
              mod.br('spin'),
            ], none)
          ),
          mod.br('done'),
        ], none)),
      ], none),
    ], none);
    mod.addFunction('__jswat_clock_sleep',
      binaryen.createType([i32]), none, [i32], body);
  }
}

// ── std/math ──────────────────────────────────────────────────────────────────

/**
 * Build std/math functions.
 * Native ops are thin wrappers; pow/sin/cos/exp/log use polynomial approximations.
 * @param {any} mod
 */
export function buildMathFunctions(mod) {
  // ── Native single-arg wrappers ─────────────────────────────────────────────
  for (const [name, op] of [
    ['__jswat_math_sqrt',  'sqrt'],
    ['__jswat_math_floor', 'floor'],
    ['__jswat_math_ceil',  'ceil'],
    ['__jswat_math_abs',   'abs'],
    ['__jswat_math_trunc', 'trunc'],
  ]) {
    mod.addFunction(name, binaryen.createType([f64]), f64, [],
      mod.return(mod.f64[op](mod.local.get(0, f64))));
  }

  // ── Native two-arg wrappers ────────────────────────────────────────────────
  for (const [name, op] of [['__jswat_math_min', 'min'], ['__jswat_math_max', 'max']]) {
    mod.addFunction(name, binaryen.createType([f64, f64]), f64, [],
      mod.return(mod.f64[op](mod.local.get(0, f64), mod.local.get(1, f64))));
  }

  // ── exp(x): Taylor series sum(x^n/n!) for n=0..20 ────────────────────────
  // params: x(0:f64); locals: result(1:f64), term(2:f64), i(3:i32)
  {
    const gx = () => mod.local.get(0, f64);
    const gr = () => mod.local.get(1, f64);
    const gt = () => mod.local.get(2, f64);
    const gi = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.f64.const(1.0)),
      mod.local.set(2, mod.f64.const(1.0)),
      mod.local.set(3, mod.i32.const(1)),
      mod.block('exp_done', [
        mod.loop('exp_loop', mod.block(null, [
          mod.br_if('exp_done', mod.i32.gt_s(gi(), mod.i32.const(20))),
          mod.local.set(2, mod.f64.div(mod.f64.mul(gt(), gx()), mod.f64.convert_s.i32(gi()))),
          mod.local.set(1, mod.f64.add(gr(), gt())),
          mod.local.set(3, mod.i32.add(gi(), mod.i32.const(1))),
          mod.br('exp_loop'),
        ], none)),
      ], none),
      mod.return(gr()),
    ], f64);
    mod.addFunction('__jswat_math_exp', binaryen.createType([f64]), f64, [f64, f64, i32], body);
  }

  // ── log(x): 2*atanh((x-1)/(x+1)), atanh(t)=sum(t^(2k+1)/(2k+1)) ─────────
  // params: x(0:f64); locals: t(1:f64), t2(2:f64), term(3:f64), result(4:f64), k(5:i32)
  {
    const gx    = () => mod.local.get(0, f64);
    const gt    = () => mod.local.get(1, f64);
    const gt2   = () => mod.local.get(2, f64);
    const gterm = () => mod.local.get(3, f64);
    const gr    = () => mod.local.get(4, f64);
    const gk    = () => mod.local.get(5, i32);
    const body = mod.block(null, [
      mod.if(mod.f64.le(gx(), mod.f64.const(0.0)), mod.return(mod.f64.const(0.0))),
      mod.local.set(1, mod.f64.div(
        mod.f64.sub(gx(), mod.f64.const(1.0)),
        mod.f64.add(gx(), mod.f64.const(1.0)))),
      mod.local.set(2, mod.f64.mul(gt(), gt())),
      mod.local.set(3, gt()),
      mod.local.set(4, mod.f64.const(0.0)),
      mod.local.set(5, mod.i32.const(0)),
      mod.block('log_done', [
        mod.loop('log_loop', mod.block(null, [
          mod.br_if('log_done', mod.i32.gt_s(gk(), mod.i32.const(24))),
          mod.local.set(4, mod.f64.add(gr(), mod.f64.div(
            gterm(),
            mod.f64.convert_s.i32(mod.i32.add(mod.i32.mul(gk(), mod.i32.const(2)), mod.i32.const(1)))))),
          mod.local.set(3, mod.f64.mul(gterm(), gt2())),
          mod.local.set(5, mod.i32.add(gk(), mod.i32.const(1))),
          mod.br('log_loop'),
        ], none)),
      ], none),
      mod.return(mod.f64.mul(mod.f64.const(2.0), gr())),
    ], f64);
    mod.addFunction('__jswat_math_log', binaryen.createType([f64]), f64, [f64, f64, f64, f64, i32], body);
  }

  // ── sin(x): Taylor with arg reduction to [-π, π] ─────────────────────────
  // params: x(0:f64); locals: k(1:f64), xsq(2:f64), result(3:f64), term(4:f64), n(5:i32), sign(6:f64)
  {
    const TWO_PI = 6.283185307179586;
    const PI     = 3.141592653589793;
    const gx    = () => mod.local.get(0, f64);
    const gk    = () => mod.local.get(1, f64);
    const gxsq  = () => mod.local.get(2, f64);
    const gr    = () => mod.local.get(3, f64);
    const gterm = () => mod.local.get(4, f64);
    const gn    = () => mod.local.get(5, i32);
    const gsign = () => mod.local.get(6, f64);
    const body = mod.block(null, [
      mod.local.set(1, mod.f64.floor(mod.f64.div(gx(), mod.f64.const(TWO_PI)))),
      mod.local.set(0, mod.f64.sub(gx(), mod.f64.mul(gk(), mod.f64.const(TWO_PI)))),
      mod.if(mod.f64.gt(gx(), mod.f64.const(PI)),
        mod.local.set(0, mod.f64.sub(gx(), mod.f64.const(TWO_PI)))),
      mod.if(mod.f64.lt(gx(), mod.f64.const(-PI)),
        mod.local.set(0, mod.f64.add(gx(), mod.f64.const(TWO_PI)))),
      mod.local.set(2, mod.f64.mul(gx(), gx())),
      mod.local.set(3, mod.f64.const(0.0)),
      mod.local.set(4, gx()),
      mod.local.set(5, mod.i32.const(0)),
      mod.local.set(6, mod.f64.const(1.0)),
      mod.block('sin_done', [
        mod.loop('sin_loop', mod.block(null, [
          mod.br_if('sin_done', mod.i32.gt_s(gn(), mod.i32.const(12))),
          mod.local.set(3, mod.f64.add(gr(), mod.f64.mul(gsign(), gterm()))),
          mod.local.set(4, mod.f64.div(
            mod.f64.mul(gterm(), gxsq()),
            mod.f64.convert_s.i32(mod.i32.mul(
              mod.i32.add(mod.i32.mul(gn(), mod.i32.const(2)), mod.i32.const(2)),
              mod.i32.add(mod.i32.mul(gn(), mod.i32.const(2)), mod.i32.const(3)))))),
          mod.local.set(6, mod.f64.sub(mod.f64.const(0.0), gsign())),
          mod.local.set(5, mod.i32.add(gn(), mod.i32.const(1))),
          mod.br('sin_loop'),
        ], none)),
      ], none),
      mod.return(gr()),
    ], f64);
    mod.addFunction('__jswat_math_sin',
      binaryen.createType([f64]), f64, [f64, f64, f64, f64, i32, f64], body);
  }

  // ── cos(x): Taylor with arg reduction to [-π, π] ─────────────────────────
  // params: x(0:f64); locals: k(1:f64), xsq(2:f64), result(3:f64), term(4:f64), n(5:i32), sign(6:f64)
  {
    const TWO_PI = 6.283185307179586;
    const PI     = 3.141592653589793;
    const gx    = () => mod.local.get(0, f64);
    const gk    = () => mod.local.get(1, f64);
    const gxsq  = () => mod.local.get(2, f64);
    const gr    = () => mod.local.get(3, f64);
    const gterm = () => mod.local.get(4, f64);
    const gn    = () => mod.local.get(5, i32);
    const gsign = () => mod.local.get(6, f64);
    const body = mod.block(null, [
      mod.local.set(1, mod.f64.floor(mod.f64.div(gx(), mod.f64.const(TWO_PI)))),
      mod.local.set(0, mod.f64.sub(gx(), mod.f64.mul(gk(), mod.f64.const(TWO_PI)))),
      mod.if(mod.f64.gt(gx(), mod.f64.const(PI)),
        mod.local.set(0, mod.f64.sub(gx(), mod.f64.const(TWO_PI)))),
      mod.if(mod.f64.lt(gx(), mod.f64.const(-PI)),
        mod.local.set(0, mod.f64.add(gx(), mod.f64.const(TWO_PI)))),
      mod.local.set(2, mod.f64.mul(gx(), gx())),
      mod.local.set(3, mod.f64.const(0.0)),
      mod.local.set(4, mod.f64.const(1.0)),
      mod.local.set(5, mod.i32.const(0)),
      mod.local.set(6, mod.f64.const(1.0)),
      mod.block('cos_done', [
        mod.loop('cos_loop', mod.block(null, [
          mod.br_if('cos_done', mod.i32.gt_s(gn(), mod.i32.const(12))),
          mod.local.set(3, mod.f64.add(gr(), mod.f64.mul(gsign(), gterm()))),
          mod.local.set(4, mod.f64.div(
            mod.f64.mul(gterm(), gxsq()),
            mod.f64.convert_s.i32(mod.i32.mul(
              mod.i32.add(mod.i32.mul(gn(), mod.i32.const(2)), mod.i32.const(1)),
              mod.i32.add(mod.i32.mul(gn(), mod.i32.const(2)), mod.i32.const(2)))))),
          mod.local.set(6, mod.f64.sub(mod.f64.const(0.0), gsign())),
          mod.local.set(5, mod.i32.add(gn(), mod.i32.const(1))),
          mod.br('cos_loop'),
        ], none)),
      ], none),
      mod.return(gr()),
    ], f64);
    mod.addFunction('__jswat_math_cos',
      binaryen.createType([f64]), f64, [f64, f64, f64, f64, i32, f64], body);
  }

  // ── pow(base, exp) = exp(exp * log(base)) ─────────────────────────────────
  mod.addFunction('__jswat_math_pow',
    binaryen.createType([f64, f64]), f64, [],
    mod.return(mod.call('__jswat_math_exp', [
      mod.f64.mul(mod.local.get(1, f64),
        mod.call('__jswat_math_log', [mod.local.get(0, f64)], f64)),
    ], f64)));
}

// ── std/iter ──────────────────────────────────────────────────────────────────
// Iterator struct: [tag:i32 @ 0][state_ptr:i32 @ 4]  (8 bytes)
// Tags: 0=ArrayIter, 1=MapIter, 2=FilterIter, 3=TakeIter
// ArrayIter state: [arr_ptr:i32 @ 0][idx:i32 @ 4][len:i32 @ 8]  (12 bytes)
// MapIter/FilterIter state: [inner:i32 @ 0][fn_idx:i32 @ 4]  (8 bytes)
// TakeIter state: [inner:i32 @ 0][remaining:i32 @ 4]  (8 bytes)

/**
 * Build std/iter functions.
 * Requires the function table '0' to already exist (for call_indirect in map/filter/forEach).
 * @param {any} mod
 */
export function buildIterFunctions(mod) {
  // ── __jswat_iter_from_array(arr:i32) -> i32 ───────────────────────────────
  // params: arr(0:i32); locals: iter(1:i32), state(2:i32)
  {
    const garr   = () => mod.local.get(0, i32);
    const giter  = () => mod.local.get(1, i32);
    const gstate = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(12)], i32)),
      mod.i32.store(0, 0, giter(), mod.i32.const(0)),        // tag = 0 (ArrayIter)
      mod.i32.store(4, 0, giter(), gstate()),                 // state ptr
      mod.i32.store(0, 0, gstate(), garr()),                  // state.arr = arr
      mod.i32.store(4, 0, gstate(), mod.i32.const(0)),        // state.idx = 0
      mod.i32.store(8, 0, gstate(),
        mod.call('__jswat_array_length', [garr()], i32)),     // state.len = len(arr)
      mod.return(giter()),
    ], i32);
    mod.addFunction('__jswat_iter_from_array', binaryen.createType([i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_next(iter:i32) -> i32  (returns -1 if exhausted) ─────────
  // params: iter(0:i32); locals: tag(1:i32), state(2:i32), idx(3:i32), len(4:i32), val(5:i32)
  {
    const giter  = () => mod.local.get(0, i32);
    const gtag   = () => mod.local.get(1, i32);
    const gstate = () => mod.local.get(2, i32);
    const gidx   = () => mod.local.get(3, i32);
    const glen   = () => mod.local.get(4, i32);
    const gval   = () => mod.local.get(5, i32);
    const M1     = () => mod.i32.const(-1);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(giter()), mod.return(M1())),
      mod.local.set(1, mod.i32.load(0, 0, giter())),    // tag
      mod.local.set(2, mod.i32.load(4, 0, giter())),    // state

      // ArrayIter (tag=0)
      mod.if(mod.i32.eq(gtag(), mod.i32.const(0)),
        mod.block(null, [
          mod.local.set(3, mod.i32.load(4, 0, gstate())),  // idx
          mod.local.set(4, mod.i32.load(8, 0, gstate())),  // len
          mod.if(mod.i32.ge_u(gidx(), glen()), mod.return(M1())),
          mod.local.set(5, mod.call('__jswat_array_get',
            [mod.i32.load(0, 0, gstate()), gidx()], i32)),
          mod.i32.store(4, 0, gstate(), mod.i32.add(gidx(), mod.i32.const(1))),
          mod.return(gval()),
        ], none)),

      // MapIter (tag=1)
      mod.if(mod.i32.eq(gtag(), mod.i32.const(1)),
        mod.block(null, [
          mod.local.set(5, mod.call('__jswat_iter_next',
            [mod.i32.load(0, 0, gstate())], i32)),
          mod.if(mod.i32.eq(gval(), M1()), mod.return(M1())),
          mod.return(mod.call_indirect('0', mod.i32.load(4, 0, gstate()), [gval()],
            binaryen.createType([i32]), i32)),
        ], none)),

      // FilterIter (tag=2)
      mod.if(mod.i32.eq(gtag(), mod.i32.const(2)),
        mod.block(null, [
          mod.block('filter_done', [
            mod.loop('filter_loop', mod.block(null, [
              mod.local.set(5, mod.call('__jswat_iter_next',
                [mod.i32.load(0, 0, gstate())], i32)),
              mod.br_if('filter_done', mod.i32.eq(gval(), M1())),
              mod.if(mod.call_indirect('0', mod.i32.load(4, 0, gstate()), [gval()],
                binaryen.createType([i32]), i32), mod.return(gval())),
              mod.br('filter_loop'),
            ], none)),
          ], none),
          mod.return(M1()),
        ], none)),

      // TakeIter (tag=3)
      mod.if(mod.i32.eq(gtag(), mod.i32.const(3)),
        mod.block(null, [
          mod.local.set(3, mod.i32.load(4, 0, gstate())),  // remaining
          mod.if(mod.i32.eqz(gidx()), mod.return(M1())),
          mod.local.set(5, mod.call('__jswat_iter_next',
            [mod.i32.load(0, 0, gstate())], i32)),
          mod.if(mod.i32.eq(gval(), M1()), mod.return(M1())),
          mod.i32.store(4, 0, gstate(), mod.i32.sub(gidx(), mod.i32.const(1))),
          mod.return(gval()),
        ], none)),

      mod.return(M1()),
    ], i32);
    mod.addFunction('__jswat_iter_next', binaryen.createType([i32]), i32, [i32, i32, i32, i32, i32], body);
  }

  // ── __jswat_iter_map(iter:i32, fn_idx:i32) -> i32 ─────────────────────────
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn     = () => mod.local.get(1, i32);
    const gnew    = () => mod.local.get(2, i32);
    const gstate  = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.local.set(3, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.i32.store(0, 0, gnew(), mod.i32.const(1)),   // tag = 1 (MapIter)
      mod.i32.store(4, 0, gnew(), gstate()),
      mod.i32.store(0, 0, gstate(), giter()),
      mod.i32.store(4, 0, gstate(), gfn()),
      mod.return(gnew()),
    ], i32);
    mod.addFunction('__jswat_iter_map', binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_filter(iter:i32, fn_idx:i32) -> i32 ─────────────────────
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn     = () => mod.local.get(1, i32);
    const gnew    = () => mod.local.get(2, i32);
    const gstate  = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.local.set(3, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.i32.store(0, 0, gnew(), mod.i32.const(2)),   // tag = 2 (FilterIter)
      mod.i32.store(4, 0, gnew(), gstate()),
      mod.i32.store(0, 0, gstate(), giter()),
      mod.i32.store(4, 0, gstate(), gfn()),
      mod.return(gnew()),
    ], i32);
    mod.addFunction('__jswat_iter_filter', binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_take(iter:i32, n:i32) -> i32 ────────────────────────────
  {
    const giter   = () => mod.local.get(0, i32);
    const gn      = () => mod.local.get(1, i32);
    const gnew    = () => mod.local.get(2, i32);
    const gstate  = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.local.set(3, mod.call('__alloc', [mod.i32.const(8)], i32)),
      mod.i32.store(0, 0, gnew(), mod.i32.const(3)),   // tag = 3 (TakeIter)
      mod.i32.store(4, 0, gnew(), gstate()),
      mod.i32.store(0, 0, gstate(), giter()),
      mod.i32.store(4, 0, gstate(), gn()),
      mod.return(gnew()),
    ], i32);
    mod.addFunction('__jswat_iter_take', binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_collect(iter:i32) -> i32 ────────────────────────────────
  // params: iter(0:i32); locals: arr(1:i32), val(2:i32)
  {
    const giter = () => mod.local.get(0, i32);
    const garr  = () => mod.local.get(1, i32);
    const gval  = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.call('__jswat_array_new', [mod.i32.const(8)], i32)),
      mod.block('collect_done', [
        mod.loop('collect_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('collect_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.drop(mod.call('__jswat_array_push', [garr(), gval()], i32)),
          mod.br('collect_loop'),
        ], none)),
      ], none),
      mod.return(garr()),
    ], i32);
    mod.addFunction('__jswat_iter_collect', binaryen.createType([i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_count(iter:i32) -> i32 ──────────────────────────────────
  // params: iter(0:i32); locals: n(1:i32), val(2:i32)
  {
    const giter = () => mod.local.get(0, i32);
    const gn    = () => mod.local.get(1, i32);
    const gval  = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.i32.const(0)),
      mod.block('count_done', [
        mod.loop('count_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('count_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.local.set(1, mod.i32.add(gn(), mod.i32.const(1))),
          mod.br('count_loop'),
        ], none)),
      ], none),
      mod.return(gn()),
    ], i32);
    mod.addFunction('__jswat_iter_count', binaryen.createType([i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_for_each(iter:i32, fn_idx:i32) -> void ──────────────────
  // params: iter(0:i32), fn_idx(1:i32); locals: val(2:i32)
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn_idx = () => mod.local.get(1, i32);
    const gval    = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.block('fe_done', [
        mod.loop('fe_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('fe_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.drop(mod.call_indirect('0', gfn_idx(), [gval()],
            binaryen.createType([i32]), i32)),
          mod.br('fe_loop'),
        ], none)),
      ], none),
    ], none);
    mod.addFunction('__jswat_iter_for_each', binaryen.createType([i32, i32]), none, [i32], body);
  }

  // ── __jswat_iter_skip(iter:i32, n:i32) -> i32 ────────────────────────────
  // Returns a new TakeIter-style iter that skips n elements.
  // Implemented as: advance n times, then return original iter.
  // params: iter(0:i32), n(1:i32); locals: rem(2:i32), val(3:i32)
  {
    const giter = () => mod.local.get(0, i32);
    const gn    = () => mod.local.get(1, i32);
    const grem  = () => mod.local.get(2, i32);
    const gval  = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(2, gn()),
      mod.block('skip_done', [
        mod.loop('skip_loop', mod.block(null, [
          mod.br_if('skip_done', mod.i32.eqz(grem())),
          mod.local.set(3, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('skip_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.local.set(2, mod.i32.sub(grem(), mod.i32.const(1))),
          mod.br('skip_loop'),
        ], none)),
      ], none),
      mod.return(giter()),
    ], i32);
    mod.addFunction('__jswat_iter_skip', binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_sum(iter:i32) -> i32 ────────────────────────────────────
  // params: iter(0:i32); locals: acc(1:i32), val(2:i32)
  {
    const giter = () => mod.local.get(0, i32);
    const gacc  = () => mod.local.get(1, i32);
    const gval  = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.i32.const(0)),
      mod.block('sum_done', [
        mod.loop('sum_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('sum_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.local.set(1, mod.i32.add(gacc(), gval())),
          mod.br('sum_loop'),
        ], none)),
      ], none),
      mod.return(gacc()),
    ], i32);
    mod.addFunction('__jswat_iter_sum', binaryen.createType([i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_reduce(iter:i32, fn_idx:i32, init:i32) -> i32 ───────────
  // params: iter(0:i32), fn_idx(1:i32), init(2:i32); locals: acc(3:i32), val(4:i32)
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn_idx = () => mod.local.get(1, i32);
    const ginit   = () => mod.local.get(2, i32);
    const gacc    = () => mod.local.get(3, i32);
    const gval    = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.local.set(3, ginit()),
      mod.block('red_done', [
        mod.loop('red_loop', mod.block(null, [
          mod.local.set(4, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('red_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.local.set(3, mod.call_indirect('0', gfn_idx(), [gacc(), gval()],
            binaryen.createType([i32, i32]), i32)),
          mod.br('red_loop'),
        ], none)),
      ], none),
      mod.return(gacc()),
    ], i32);
    mod.addFunction('__jswat_iter_reduce', binaryen.createType([i32, i32, i32]), i32, [i32, i32], body);
  }

  // ── __jswat_iter_find(iter:i32, fn_idx:i32) -> i32  (-1 if not found) ────
  // params: iter(0:i32), fn_idx(1:i32); locals: val(2:i32)
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn_idx = () => mod.local.get(1, i32);
    const gval    = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.block('find_done', [
        mod.loop('find_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('find_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.if(
            mod.call_indirect('0', gfn_idx(), [gval()],
              binaryen.createType([i32]), i32),
            mod.return(gval())),
          mod.br('find_loop'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(-1)),
    ], i32);
    mod.addFunction('__jswat_iter_find', binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // ── __jswat_iter_any(iter:i32, fn_idx:i32) -> i32  (1=true, 0=false) ────
  // params: iter(0:i32), fn_idx(1:i32); locals: val(2:i32)
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn_idx = () => mod.local.get(1, i32);
    const gval    = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.block('any_done', [
        mod.loop('any_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('any_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.if(
            mod.call_indirect('0', gfn_idx(), [gval()],
              binaryen.createType([i32]), i32),
            mod.return(mod.i32.const(1))),
          mod.br('any_loop'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(0)),
    ], i32);
    mod.addFunction('__jswat_iter_any', binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // ── __jswat_iter_all(iter:i32, fn_idx:i32) -> i32  (1=true, 0=false) ────
  // params: iter(0:i32), fn_idx(1:i32); locals: val(2:i32)
  {
    const giter   = () => mod.local.get(0, i32);
    const gfn_idx = () => mod.local.get(1, i32);
    const gval    = () => mod.local.get(2, i32);
    const body = mod.block(null, [
      mod.block('all_done', [
        mod.loop('all_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('all_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.if(
            mod.i32.eqz(mod.call_indirect('0', gfn_idx(), [gval()],
              binaryen.createType([i32]), i32)),
            mod.return(mod.i32.const(0))),
          mod.br('all_loop'),
        ], none)),
      ], none),
      mod.return(mod.i32.const(1)),
    ], i32);
    mod.addFunction('__jswat_iter_all', binaryen.createType([i32, i32]), i32, [i32], body);
  }

  // ── __jswat_iter_min(iter:i32) -> i32  (-1 if empty) ────────────────────
  // params: iter(0:i32); locals: best(1:i32), val(2:i32), first(3:i32)
  {
    const giter  = () => mod.local.get(0, i32);
    const gbest  = () => mod.local.get(1, i32);
    const gval   = () => mod.local.get(2, i32);
    const gfirst = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(3, mod.i32.const(1)),  // first = true
      mod.block('min_done', [
        mod.loop('min_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('min_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.if(
            mod.i32.or(gfirst(), mod.i32.lt_s(gval(), gbest())),
            mod.block(null, [
              mod.local.set(1, gval()),
              mod.local.set(3, mod.i32.const(0)),
            ], none)),
          mod.br('min_loop'),
        ], none)),
      ], none),
      mod.return(mod.if(gfirst(), mod.i32.const(-1), gbest(), binaryen.i32)),
    ], i32);
    mod.addFunction('__jswat_iter_min', binaryen.createType([i32]), i32, [i32, i32, i32], body);
  }

  // ── __jswat_iter_max(iter:i32) -> i32  (-1 if empty) ────────────────────
  // params: iter(0:i32); locals: best(1:i32), val(2:i32), first(3:i32)
  {
    const giter  = () => mod.local.get(0, i32);
    const gbest  = () => mod.local.get(1, i32);
    const gval   = () => mod.local.get(2, i32);
    const gfirst = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.local.set(3, mod.i32.const(1)),  // first = true
      mod.block('max_done', [
        mod.loop('max_loop', mod.block(null, [
          mod.local.set(2, mod.call('__jswat_iter_next', [giter()], i32)),
          mod.br_if('max_done', mod.i32.eq(gval(), mod.i32.const(-1))),
          mod.if(
            mod.i32.or(gfirst(), mod.i32.gt_s(gval(), gbest())),
            mod.block(null, [
              mod.local.set(1, gval()),
              mod.local.set(3, mod.i32.const(0)),
            ], none)),
          mod.br('max_loop'),
        ], none)),
      ], none),
      mod.return(mod.if(gfirst(), mod.i32.const(-1), gbest(), binaryen.i32)),
    ], i32);
    mod.addFunction('__jswat_iter_max', binaryen.createType([i32]), i32, [i32, i32, i32], body);
  }
}

// ── std/random ────────────────────────────────────────────────────────────────

/**
 * Build std/random implementations backed by WASI random_get with XorShift fallback.
 * @param {any} mod
 * @param {number} randomBase  scratch memory base for random bytes
 */
export function buildRandomFunctions(mod, randomBase) {
  mod.addGlobal('__jswat_rng_state', i32, true, mod.i32.const(0));

  // __jswat_random_seed(s:i32) -> void
  mod.addFunction('__jswat_random_seed',
    binaryen.createType([i32]), none, [],
    mod.global.set('__jswat_rng_state', mod.local.get(0, i32)));

  // __jswat_random_float() -> f64
  // locals: state(0)
  {
    const getState = () => mod.local.get(0, i32);
    const body = mod.block(null, [
      // state = rng_state; if state == 0 use WASI
      mod.if(
        mod.i32.eqz(
          mod.local.tee(0, mod.global.get('__jswat_rng_state', i32), i32)
        ),
        mod.block(null, [
          mod.drop(mod.call('random_get', [
            mod.i32.const(randomBase), mod.i32.const(8),
          ], i32)),
          mod.return(mod.f64.div(
            mod.f64.convert_u.i64(mod.i64.load(0, 0, mod.i32.const(randomBase))),
            mod.f64.const(2 ** 64)
          )),
        ], none)
      ),
      // XorShift32
      mod.local.set(0, mod.i32.xor(getState(), mod.i32.shl(getState(), mod.i32.const(13)))),
      mod.local.set(0, mod.i32.xor(getState(), mod.i32.shr_u(getState(), mod.i32.const(17)))),
      mod.local.set(0, mod.i32.xor(getState(), mod.i32.shl(getState(), mod.i32.const(5)))),
      mod.global.set('__jswat_rng_state', getState()),
      mod.return(mod.f64.div(
        mod.f64.convert_u.i32(getState()),
        mod.f64.const(4294967296)
      )),
    ], f64);
    mod.addFunction('__jswat_random_float',
      binaryen.createType([]), f64, [i32], body);
  }
}

// ── std/alloc/pool ────────────────────────────────────────────────────────────
// Pool layout: [stride:i32][cap:i32][next:i32][freelist:i32][data: stride*cap bytes]
// Offsets:       0           4        8          12            16

/**
 * Build pool allocator runtime functions.
 * @param {any} mod
 */
export function buildPoolFunctions(mod) {
  // __jswat_pool_new(stride:i32, cap:i32) -> i32 (pool ptr)
  // params: stride(0), cap(1); locals: pool(2), dataSize(3)
  {
    const getStride  = () => mod.local.get(0, i32);
    const getCap     = () => mod.local.get(1, i32);
    const getPool    = () => mod.local.get(2, i32);
    const getDataSz  = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      // dataSize = stride * cap
      mod.local.set(3, mod.i32.mul(getStride(), getCap())),
      // pool = __jswat_alloc(16 + dataSize)
      mod.local.set(2, mod.call('__jswat_alloc',
        [mod.i32.add(mod.i32.const(16), getDataSz())], i32)),
      // pool[0] = stride
      mod.i32.store(0, 0, getPool(), getStride()),
      // pool[4] = cap
      mod.i32.store(4, 0, getPool(), getCap()),
      // pool[8] = 0  (next free slot index)
      mod.i32.store(8, 0, getPool(), mod.i32.const(0)),
      // pool[12] = 0 (freelist head, 0 = empty)
      mod.i32.store(12, 0, getPool(), mod.i32.const(0)),
      mod.return(getPool()),
    ], i32);
    mod.addFunction('__jswat_pool_new',
      binaryen.createType([i32, i32]), i32, [i32, i32], body);
  }

  // __jswat_pool_alloc(pool:i32) -> i32 (ptr to slot)
  // params: pool(0); locals: freelist(1), stride(2), next(3), ptr(4)
  {
    const getPool     = () => mod.local.get(0, i32);
    const getFreelist = () => mod.local.get(1, i32);
    const getStride   = () => mod.local.get(2, i32);
    const getNext     = () => mod.local.get(3, i32);
    const getPtr      = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.local.set(1, mod.i32.load(12, 0, getPool())),  // freelist
      mod.local.set(2, mod.i32.load(0,  0, getPool())),  // stride
      mod.if(
        mod.i32.ne(getFreelist(), mod.i32.const(0)),
        // freelist not empty: pop head
        mod.block(null, [
          // ptr = freelist head (stores abs pointer to slot)
          mod.local.set(4, getFreelist()),
          // freelist = *ptr (next pointer stored at slot start)
          mod.i32.store(12, 0, getPool(), mod.i32.load(0, 0, getPtr())),
          mod.return(getPtr()),
        ], none),
        // freelist empty: bump next
        mod.block(null, [
          mod.local.set(3, mod.i32.load(8, 0, getPool())), // next index
          // ptr = pool + 16 + next * stride
          mod.local.set(4, mod.i32.add(
            mod.i32.add(getPool(), mod.i32.const(16)),
            mod.i32.mul(getNext(), getStride())
          )),
          // pool[8] = next + 1
          mod.i32.store(8, 0, getPool(), mod.i32.add(getNext(), mod.i32.const(1))),
          mod.return(getPtr()),
        ], none)
      ),
      mod.return(mod.i32.const(0)), // unreachable
    ], i32);
    mod.addFunction('__jswat_pool_alloc',
      binaryen.createType([i32]), i32, [i32, i32, i32, i32], body);
  }

  // __jswat_pool_free(pool:i32, ptr:i32) -> void
  // Push ptr onto the freelist; store old freelist head at ptr[0]
  {
    const getPool = () => mod.local.get(0, i32);
    const getPtr  = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      // *ptr = current freelist head
      mod.i32.store(0, 0, getPtr(), mod.i32.load(12, 0, getPool())),
      // pool[12] = ptr
      mod.i32.store(12, 0, getPool(), getPtr()),
    ], none);
    mod.addFunction('__jswat_pool_free',
      binaryen.createType([i32, i32]), none, [], body);
  }
}

// ── std/alloc/arena ───────────────────────────────────────────────────────────
// Arena layout: [base:i32 4B][ptr:i32 4B][cap:i32 4B][data: cap bytes]
// Offsets:        0            4            8            12

/**
 * Build arena allocator runtime functions.
 * @param {any} mod
 */
export function buildArenaFunctions(mod) {
  // __jswat_arena_new(size:i32) -> i32 (arena ptr)
  // params: size(0); locals: arena(1)
  {
    const getSize  = () => mod.local.get(0, i32);
    const getArena = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      // arena = __jswat_alloc(12 + size)
      mod.local.set(1, mod.call('__jswat_alloc',
        [mod.i32.add(mod.i32.const(12), getSize())], i32)),
      // base = arena + 12
      mod.i32.store(0, 0, getArena(),
        mod.i32.add(getArena(), mod.i32.const(12))),
      // ptr = base
      mod.i32.store(4, 0, getArena(),
        mod.i32.add(getArena(), mod.i32.const(12))),
      // cap = size
      mod.i32.store(8, 0, getArena(), getSize()),
      mod.return(getArena()),
    ], i32);
    mod.addFunction('__jswat_arena_new',
      binaryen.createType([i32]), i32, [i32], body);
  }

  // __jswat_arena_alloc(arena:i32, n:i32) -> i32 (allocated ptr)
  // params: arena(0), n(1); locals: ptr(2), base(3), cap(4)
  {
    const getArena = () => mod.local.get(0, i32);
    const getN     = () => mod.local.get(1, i32);
    const getPtr   = () => mod.local.get(2, i32);
    const getBase  = () => mod.local.get(3, i32);
    const getCap   = () => mod.local.get(4, i32);
    const body = mod.block(null, [
      mod.local.set(2, mod.i32.load(4, 0, getArena())),  // ptr
      mod.local.set(3, mod.i32.load(0, 0, getArena())),  // base
      mod.local.set(4, mod.i32.load(8, 0, getArena())),  // cap
      // if (ptr - base + n > cap) return 0 (OOM)
      mod.if(
        mod.i32.gt_u(
          mod.i32.add(mod.i32.sub(getPtr(), getBase()), getN()),
          getCap()
        ),
        mod.return(mod.i32.const(0))
      ),
      // arena[4] = ptr + n
      mod.i32.store(4, 0, getArena(), mod.i32.add(getPtr(), getN())),
      mod.return(getPtr()),
    ], i32);
    mod.addFunction('__jswat_arena_alloc',
      binaryen.createType([i32, i32]), i32, [i32, i32, i32], body);
  }

  // __jswat_arena_reset(arena:i32) -> void
  {
    const getArena = () => mod.local.get(0, i32);
    mod.addFunction('__jswat_arena_reset',
      binaryen.createType([i32]), none, [],
      // arena[4] = arena[0]  (reset ptr to base)
      mod.i32.store(4, 0, getArena(), mod.i32.load(0, 0, getArena())));
  }
}

// ── Reference-counting GC ─────────────────────────────────────────────────────

/**
 * Build RC runtime functions: __jswat_rc_inc, __jswat_rc_dec, __jswat_dispose.
 *
 * Object header layout (12 bytes before fields):
 *   offset 0: rc_class  — bits[31:28]=size-class-index, bits[27:0]=refcount
 *   offset 4: vtable_ptr — pointer to vtable, or 0
 *   offset 8: class_id  — unique u32 per class
 *
 * @param {any} mod  binaryen Module
 */
export function buildRcFunctions(mod) {
  // 0xF0000000 as signed i32 = -268435456
  const RC_HIGH_MASK = -268435456 | 0;   // bits[31:28]
  const RC_LOW_MASK  = 0x0FFFFFFF;        // bits[27:0]

  // __jswat_dispose(ptr: i32) -> void
  // Stub: vtable_ptr = 0 for all classes, so always no-op for now.
  // Future: read vtable_ptr at ptr+4, call_indirect dispose_fn if != 0.
  mod.addFunction('__jswat_dispose',
    binaryen.createType([i32]), none, [], mod.nop());

  // __jswat_rc_inc(ptr: i32) -> void
  // params: ptr(0); locals: rc(1)
  {
    const getPtr = () => mod.local.get(0, i32);
    const getRc  = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getPtr()), mod.return()),
      mod.local.set(1, mod.i32.load(0, 0, getPtr())),
      mod.if(mod.i32.eq(getRc(), mod.i32.const(-1)), mod.return()),
      mod.i32.store(0, 0, getPtr(),
        mod.i32.or(
          mod.i32.and(getRc(), mod.i32.const(RC_HIGH_MASK)),
          mod.i32.add(mod.i32.and(getRc(), mod.i32.const(RC_LOW_MASK)), mod.i32.const(1))
        )
      ),
    ], none);
    mod.addFunction('__jswat_rc_inc',
      binaryen.createType([i32]), none, [i32], body);
  }

  // __jswat_rc_dec(ptr: i32) -> void
  // params: ptr(0); locals: rc(1), newCount(2), size(3)
  {
    const getPtr      = () => mod.local.get(0, i32);
    const getRc       = () => mod.local.get(1, i32);
    const getNewCount = () => mod.local.get(2, i32);
    const getSize     = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getPtr()), mod.return()),
      mod.local.set(1, mod.i32.load(0, 0, getPtr())),
      mod.if(mod.i32.eq(getRc(), mod.i32.const(-1)), mod.return()),
      mod.local.set(2, mod.i32.sub(
        mod.i32.and(getRc(), mod.i32.const(RC_LOW_MASK)),
        mod.i32.const(1)
      )),
      mod.if(
        mod.i32.eqz(getNewCount()),
        // rc hits 0: size = 8 << (rc >> 28), dispose, free
        mod.block(null, [
          mod.local.set(3, mod.i32.shl(
            mod.i32.const(8),
            mod.i32.shr_u(getRc(), mod.i32.const(28))
          )),
          mod.call('__jswat_dispose', [getPtr()], none),
          mod.call('__jswat_free',    [getPtr(), getSize()], none),
        ], none),
        // else: update refcount
        mod.i32.store(0, 0, getPtr(),
          mod.i32.or(
            mod.i32.and(getRc(), mod.i32.const(RC_HIGH_MASK)),
            getNewCount()
          )
        )
      ),
    ], none);
    mod.addFunction('__jswat_rc_dec',
      binaryen.createType([i32]), none, [i32, i32, i32], body);
  }

  // __jswat_str_rc_inc(ptr: i32) -> void
  // Sentinel: rc = 0xFFFFFFFF (-1 as i32) means pinned static str; never increment.
  // params: ptr(0); locals: rc(1)
  {
    const getPtr = () => mod.local.get(0, i32);
    const getRc  = () => mod.local.get(1, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getPtr()), mod.return()),
      mod.local.set(1, mod.i32.load(0, 0, getPtr())),
      mod.if(mod.i32.eq(getRc(), mod.i32.const(-1)), mod.return()),  // sentinel: pinned
      mod.i32.store(0, 0, getPtr(), mod.i32.add(getRc(), mod.i32.const(1))),
    ], none);
    mod.addFunction('__jswat_str_rc_inc',
      binaryen.createType([i32]), none, [i32], body);
  }

  // __jswat_str_rc_dec(ptr: i32) -> void
  // When rc hits 0: free(ptr, len + 12).
  // params: ptr(0); locals: rc(1), newRc(2), len(3)
  {
    const getPtr   = () => mod.local.get(0, i32);
    const getRc    = () => mod.local.get(1, i32);
    const getNewRc = () => mod.local.get(2, i32);
    const getLen   = () => mod.local.get(3, i32);
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getPtr()), mod.return()),
      mod.local.set(1, mod.i32.load(0, 0, getPtr())),
      mod.if(mod.i32.eq(getRc(), mod.i32.const(-1)), mod.return()),  // sentinel: pinned
      mod.local.set(2, mod.i32.sub(getRc(), mod.i32.const(1))),
      mod.if(
        mod.i32.eqz(getNewRc()),
        mod.block(null, [
          mod.local.set(3, mod.i32.load(4, 0, getPtr())),             // len at offset 4
          mod.call('__jswat_free', [getPtr(),
            mod.i32.add(getLen(), mod.i32.const(12))], none),
        ], none),
        mod.i32.store(0, 0, getPtr(), getNewRc()),
      ),
    ], none);
    mod.addFunction('__jswat_str_rc_dec',
      binaryen.createType([i32]), none, [i32, i32, i32], body);
  }
}

// ── String parsing ────────────────────────────────────────────────────────────

/**
 * Build __jswat_parse_i32 and __jswat_parse_f64 for str→number casts.
 *
 * String layout: [rc:4][len:4][hash:4][bytes...]  — ptr points to offset 0.
 *
 * @param {any} mod  binaryen Module
 */
export function buildParseFunctions(mod) {
  // __jswat_parse_i32(ptr: i32) -> i32
  // Reads decimal integer from str bytes. Handles leading whitespace and '-'.
  // params: ptr(0); locals: len(1), i(2), ch(3), result(4), neg(5)
  {
    const getPtr    = () => mod.local.get(0, i32);
    const getLen    = () => mod.local.get(1, i32);
    const getI      = () => mod.local.get(2, i32);
    const getCh     = () => mod.local.get(3, i32);
    const getResult = () => mod.local.get(4, i32);
    const getNeg    = () => mod.local.get(5, i32);
    // String layout: [rc:4][len:4][hash:4][bytes...], bytes start at ptr+12
    const getBase   = () => mod.i32.add(getPtr(), mod.i32.const(12));
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getPtr()), mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getPtr())),   // len at offset 4
      mod.local.set(2, mod.i32.const(0)),                // i = 0
      mod.local.set(4, mod.i32.const(0)),                // result = 0
      mod.local.set(5, mod.i32.const(0)),                // neg = 0
      // skip leading whitespace
      mod.block('ws_done', [
        mod.loop('ws_loop', mod.block(null, [
          mod.br_if('ws_done', mod.i32.ge_u(getI(), getLen())),
          mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI()))),
          mod.br_if('ws_done', mod.i32.gt_u(getCh(), mod.i32.const(32))),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          mod.br('ws_loop'),
        ], none)),
      ]),
      // check for '-'
      mod.if(
        mod.i32.and(
          mod.i32.lt_u(getI(), getLen()),
          mod.i32.eq(
            mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI())),
            mod.i32.const(45) // '-'
          )
        ),
        mod.block(null, [
          mod.local.set(5, mod.i32.const(1)),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
        ], none)
      ),
      // parse digits
      mod.block('dig_done', [
        mod.loop('dig_loop', mod.block(null, [
          mod.br_if('dig_done', mod.i32.ge_u(getI(), getLen())),
          mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI()))),
          mod.br_if('dig_done', mod.i32.lt_u(getCh(), mod.i32.const(48))),  // < '0'
          mod.br_if('dig_done', mod.i32.gt_u(getCh(), mod.i32.const(57))),  // > '9'
          mod.local.set(4, mod.i32.add(
            mod.i32.mul(getResult(), mod.i32.const(10)),
            mod.i32.sub(getCh(), mod.i32.const(48))
          )),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          mod.br('dig_loop'),
        ], none)),
      ]),
      mod.return(mod.if(
        getNeg(),
        mod.i32.sub(mod.i32.const(0), getResult()),
        getResult(),
        binaryen.i32
      )),
    ], i32);
    mod.addFunction('__jswat_parse_i32',
      binaryen.createType([i32]), i32, [i32, i32, i32, i32, i32], body);
  }

  // __jswat_parse_f64(ptr: i32) -> f64
  // Parses decimal float (integer part + optional fractional part).
  // params: ptr(0); locals: len(1), i(2), ch(3), intPart(4), fracPart(5), fracDiv(6), neg(7)
  {
    const getPtr     = () => mod.local.get(0, i32);
    const getLen     = () => mod.local.get(1, i32);
    const getI       = () => mod.local.get(2, i32);
    const getCh      = () => mod.local.get(3, i32);
    const getIntPart = () => mod.local.get(4, f64);
    const getFrac    = () => mod.local.get(5, f64);
    const getFracDiv = () => mod.local.get(6, f64);
    const getNeg     = () => mod.local.get(7, i32);
    const getBase    = () => mod.i32.add(getPtr(), mod.i32.const(12));
    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getPtr()), mod.return(mod.f64.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getPtr())),  // len at offset 4
      mod.local.set(2, mod.i32.const(0)),
      mod.local.set(4, mod.f64.const(0)),
      mod.local.set(5, mod.f64.const(0)),
      mod.local.set(6, mod.f64.const(1)),
      mod.local.set(7, mod.i32.const(0)),
      // skip whitespace
      mod.block('ws2_done', [
        mod.loop('ws2_loop', mod.block(null, [
          mod.br_if('ws2_done', mod.i32.ge_u(getI(), getLen())),
          mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI()))),
          mod.br_if('ws2_done', mod.i32.gt_u(getCh(), mod.i32.const(32))),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          mod.br('ws2_loop'),
        ], none)),
      ]),
      // check '-'
      mod.if(
        mod.i32.and(
          mod.i32.lt_u(getI(), getLen()),
          mod.i32.eq(mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI())), mod.i32.const(45))
        ),
        mod.block(null, [
          mod.local.set(7, mod.i32.const(1)),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
        ], none)
      ),
      // integer digits
      mod.block('fdig_done', [
        mod.loop('fdig_loop', mod.block(null, [
          mod.br_if('fdig_done', mod.i32.ge_u(getI(), getLen())),
          mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI()))),
          mod.br_if('fdig_done', mod.i32.lt_u(getCh(), mod.i32.const(48))),
          mod.br_if('fdig_done', mod.i32.gt_u(getCh(), mod.i32.const(57))),
          mod.local.set(4, mod.f64.add(
            mod.f64.mul(getIntPart(), mod.f64.const(10)),
            mod.f64.convert_s.i32(mod.i32.sub(getCh(), mod.i32.const(48)))
          )),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          mod.br('fdig_loop'),
        ], none)),
      ]),
      // check '.'
      mod.if(
        mod.i32.and(
          mod.i32.lt_u(getI(), getLen()),
          mod.i32.eq(mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI())), mod.i32.const(46))
        ),
        mod.block(null, [
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          // fractional digits
          mod.block('fracdig_done', [
            mod.loop('fracdig_loop', mod.block(null, [
              mod.br_if('fracdig_done', mod.i32.ge_u(getI(), getLen())),
              mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(getBase(), getI()))),
              mod.br_if('fracdig_done', mod.i32.lt_u(getCh(), mod.i32.const(48))),
              mod.br_if('fracdig_done', mod.i32.gt_u(getCh(), mod.i32.const(57))),
              mod.local.set(6, mod.f64.mul(getFracDiv(), mod.f64.const(10))),
              mod.local.set(5, mod.f64.add(
                mod.f64.mul(getFrac(), mod.f64.const(10)),
                mod.f64.convert_s.i32(mod.i32.sub(getCh(), mod.i32.const(48)))
              )),
              mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
              mod.br('fracdig_loop'),
            ], none)),
          ]),
        ], none)
      ),
      mod.return(mod.if(
        getNeg(),
        mod.f64.neg(mod.f64.add(getIntPart(), mod.f64.div(getFrac(), getFracDiv()))),
        mod.f64.add(getIntPart(), mod.f64.div(getFrac(), getFracDiv())),
        f64
      )),
    ], f64);
    mod.addFunction('__jswat_parse_f64',
      binaryen.createType([i32]), f64, [i32, i32, i32, f64, f64, f64, i32], body);
  }
}

// ── std/process ───────────────────────────────────────────────────────────────

/**
 * Build Process runtime functions.
 * @param {any} mod  binaryen Module
 * @param {boolean} isUnknown  true for wasm32-unknown target
 */
export function buildProcessFunctions(mod, isUnknown) {
  // __jswat_process_exit(code:i32) -> void
  // wasip1: call proc_exit; unknown: unreachable (trap)
  {
    const body = isUnknown
      ? mod.unreachable()
      : mod.block(null, [
          mod.call('proc_exit', [mod.local.get(0, i32)], none),
          mod.unreachable(),
        ], none);
    mod.addFunction('__jswat_process_exit',
      binaryen.createType([i32]), none, [], body);
  }

  // __jswat_process_env(name:i32) -> i32 (str ptr, or 0 if not found)
  // Returns 0 (null) — full WASI environ_get deferred
  mod.addFunction('__jswat_process_env',
    binaryen.createType([i32]), i32, [],
    mod.return(mod.i32.const(0)));

  // __jswat_process_args() -> i32 (str ptr, or 0)
  // Returns 0 (null) — full WASI args_get deferred
  mod.addFunction('__jswat_process_args',
    binaryen.createType([]), i32, [],
    mod.return(mod.i32.const(0)));
}

// ── std/encoding ──────────────────────────────────────────────────────────────

/**
 * Build Base64 and UTF8 encoding runtime functions.
 * @param {any} mod  binaryen Module
 */
export function buildEncodingFunctions(mod) {
  // Base64 alphabet: A-Z a-z 0-9 + /  (64 chars)
  // Stored as a data segment at compile time; we compute offsets from the str.

  // __jswat_base64_encode(src:i32) -> i32 (new str ptr)
  // str layout: [rc:4][len:4][hash:4][bytes...]
  // Output length: ceil(len/3)*4 + padding
  {
    // params: src(0); locals: slen(1), olen(2), out(3), si(4), oi(5), b0(6), b1(7), b2(8)
    const getSrc   = () => mod.local.get(0, i32);
    const getSlen  = () => mod.local.get(1, i32);
    const getOlen  = () => mod.local.get(2, i32);
    const getOut   = () => mod.local.get(3, i32);
    const getSi    = () => mod.local.get(4, i32);
    const getOi    = () => mod.local.get(5, i32);
    const getB0    = () => mod.local.get(6, i32);
    const getB1    = () => mod.local.get(7, i32);
    const getB2    = () => mod.local.get(8, i32);
    const srcBytes = () => mod.i32.add(getSrc(), mod.i32.const(12));
    const outBytes = () => mod.i32.add(getOut(), mod.i32.const(12));

    // Base64 table: each index maps to an ASCII character code
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    /** @param {number} idx */
    const b64char = (idx) => {
      // inline 64-entry lookup via nested i32.select or just a function call
      // Simplest: compute from the index
      // 0-25 → 65-90 (A-Z), 26-51 → 97-122 (a-z), 52-61 → 48-57 (0-9), 62 → 43 (+), 63 → 47 (/)
      return mod.if(
        mod.i32.lt_u(idx, mod.i32.const(26)),
        mod.i32.add(idx, mod.i32.const(65)),   // A-Z
        mod.if(
          mod.i32.lt_u(idx, mod.i32.const(52)),
          mod.i32.add(idx, mod.i32.const(71)),  // a-z: idx-26+97 = idx+71
          mod.if(
            mod.i32.lt_u(idx, mod.i32.const(62)),
            mod.i32.sub(idx, mod.i32.const(4)), // 0-9: idx-52+48 = idx-4
            mod.if(
              mod.i32.eq(idx, mod.i32.const(62)),
              mod.i32.const(43),               // +
              mod.i32.const(47),               // /
              i32
            ),
            i32
          ),
          i32
        ),
        i32
      );
    };

    const writeChar = (outIdx, val) =>
      mod.i32.store8(0, 0, mod.i32.add(outBytes(), outIdx), val);

    const body = mod.block(null, [
      // if src == 0, return 0
      mod.if(mod.i32.eqz(getSrc()), mod.return(mod.i32.const(0))),
      // slen = src[4]  (len field)
      mod.local.set(1, mod.i32.load(4, 0, getSrc())),
      // olen = ((slen + 2) / 3) * 4
      mod.local.set(2, mod.i32.mul(
        mod.i32.div_u(mod.i32.add(getSlen(), mod.i32.const(2)), mod.i32.const(3)),
        mod.i32.const(4)
      )),
      // out = alloc(olen + 12)
      mod.local.set(3, mod.call('__jswat_alloc', [mod.i32.add(getOlen(), mod.i32.const(12))], i32)),
      // write header: rc=1, len=olen, hash=0
      mod.i32.store(0, 0, getOut(), mod.i32.const(1)),
      mod.i32.store(4, 0, getOut(), getOlen()),
      mod.i32.store(8, 0, getOut(), mod.i32.const(0)),
      // si=0, oi=0
      mod.local.set(4, mod.i32.const(0)),
      mod.local.set(5, mod.i32.const(0)),
      // encode loop
      mod.block('enc_done', [
        mod.loop('enc_loop', mod.block(null, [
          mod.br_if('enc_done', mod.i32.ge_u(getSi(), getSlen())),
          // b0 = src[si]
          mod.local.set(6, mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), getSi()))),
          // b1 = si+1 < slen ? src[si+1] : 0
          mod.local.set(7, mod.if(
            mod.i32.lt_u(mod.i32.add(getSi(), mod.i32.const(1)), getSlen()),
            mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.add(getSi(), mod.i32.const(1)))),
            mod.i32.const(0),
            i32
          )),
          // b2 = si+2 < slen ? src[si+2] : 0
          mod.local.set(8, mod.if(
            mod.i32.lt_u(mod.i32.add(getSi(), mod.i32.const(2)), getSlen()),
            mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.add(getSi(), mod.i32.const(2)))),
            mod.i32.const(0),
            i32
          )),
          // out[oi] = b64[(b0>>2) & 0x3F]
          writeChar(getOi(), b64char(mod.i32.shr_u(getB0(), mod.i32.const(2)))),
          // out[oi+1] = b64[((b0&3)<<4)|(b1>>4)]
          writeChar(mod.i32.add(getOi(), mod.i32.const(1)),
            b64char(mod.i32.or(
              mod.i32.shl(mod.i32.and(getB0(), mod.i32.const(3)), mod.i32.const(4)),
              mod.i32.shr_u(getB1(), mod.i32.const(4))
            ))),
          // out[oi+2] = si+1 < slen ? b64[((b1&0xF)<<2)|(b2>>6)] : '='
          writeChar(mod.i32.add(getOi(), mod.i32.const(2)), mod.if(
            mod.i32.lt_u(mod.i32.add(getSi(), mod.i32.const(1)), getSlen()),
            b64char(mod.i32.or(
              mod.i32.shl(mod.i32.and(getB1(), mod.i32.const(15)), mod.i32.const(2)),
              mod.i32.shr_u(getB2(), mod.i32.const(6))
            )),
            mod.i32.const(61), // '='
            i32
          )),
          // out[oi+3] = si+2 < slen ? b64[b2&0x3F] : '='
          writeChar(mod.i32.add(getOi(), mod.i32.const(3)), mod.if(
            mod.i32.lt_u(mod.i32.add(getSi(), mod.i32.const(2)), getSlen()),
            b64char(mod.i32.and(getB2(), mod.i32.const(63))),
            mod.i32.const(61), // '='
            i32
          )),
          mod.local.set(4, mod.i32.add(getSi(), mod.i32.const(3))),
          mod.local.set(5, mod.i32.add(getOi(), mod.i32.const(4))),
          mod.br('enc_loop'),
        ], none)),
      ]),
      mod.return(getOut()),
    ], i32);
    mod.addFunction('__jswat_base64_encode',
      binaryen.createType([i32]), i32, [i32, i32, i32, i32, i32, i32, i32, i32], body);
  }

  // __jswat_base64_decode(src:i32) -> i32 (new str ptr with decoded bytes)
  {
    // params: src(0); locals: slen(1), olen(2), out(3), si(4), oi(5),
    //         c0(6), c1(7), c2(8), c3(9), v0(10), v1(11), v2(12), v3(13)
    const getSrc   = () => mod.local.get(0, i32);
    const getSlen  = () => mod.local.get(1, i32);
    const getOlen  = () => mod.local.get(2, i32);
    const getOut   = () => mod.local.get(3, i32);
    const getSi    = () => mod.local.get(4, i32);
    const getOi    = () => mod.local.get(5, i32);
    const getC0    = () => mod.local.get(6, i32);
    const getC1    = () => mod.local.get(7, i32);
    const getC2    = () => mod.local.get(8, i32);
    const getC3    = () => mod.local.get(9, i32);
    const getV0    = () => mod.local.get(10, i32);
    const getV1    = () => mod.local.get(11, i32);
    const getV2    = () => mod.local.get(12, i32);
    const getV3    = () => mod.local.get(13, i32);
    const srcBytes = () => mod.i32.add(getSrc(), mod.i32.const(12));
    const outBytes = () => mod.i32.add(getOut(), mod.i32.const(12));

    // Decode a base64 char to 0-63 (returns 0 for padding '=')
    const b64val = (ch) => mod.if(
      mod.i32.and(mod.i32.ge_u(ch, mod.i32.const(65)), mod.i32.le_u(ch, mod.i32.const(90))),
      mod.i32.sub(ch, mod.i32.const(65)),          // A-Z → 0-25
      mod.if(
        mod.i32.and(mod.i32.ge_u(ch, mod.i32.const(97)), mod.i32.le_u(ch, mod.i32.const(122))),
        mod.i32.sub(ch, mod.i32.const(71)),         // a-z → 26-51
        mod.if(
          mod.i32.and(mod.i32.ge_u(ch, mod.i32.const(48)), mod.i32.le_u(ch, mod.i32.const(57))),
          mod.i32.add(ch, mod.i32.const(4)),         // 0-9 → 52-61
          mod.if(
            mod.i32.eq(ch, mod.i32.const(43)),
            mod.i32.const(62),                       // + → 62
            mod.i32.const(63),                       // / or = → 63/0
            i32
          ),
          i32
        ),
        i32
      ),
      i32
    );

    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getSrc()), mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getSrc())),
      // olen = (slen / 4) * 3, minus padding '=' chars at end
      mod.local.set(2, mod.i32.mul(
        mod.i32.div_u(getSlen(), mod.i32.const(4)), mod.i32.const(3)
      )),
      // Subtract 1 for each trailing '=' padding char (up to 2)
      mod.if(mod.i32.and(
        mod.i32.gt_u(getSlen(), mod.i32.const(0)),
        mod.i32.eq(mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.sub(getSlen(), mod.i32.const(1)))), mod.i32.const(61))
      ), mod.local.set(2, mod.i32.sub(getOlen(), mod.i32.const(1)))),
      mod.if(mod.i32.and(
        mod.i32.gt_u(getSlen(), mod.i32.const(1)),
        mod.i32.eq(mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.sub(getSlen(), mod.i32.const(2)))), mod.i32.const(61))
      ), mod.local.set(2, mod.i32.sub(getOlen(), mod.i32.const(1)))),
      mod.local.set(3, mod.call('__jswat_alloc', [mod.i32.add(getOlen(), mod.i32.const(12))], i32)),
      mod.i32.store(0, 0, getOut(), mod.i32.const(1)),
      mod.i32.store(4, 0, getOut(), getOlen()),
      mod.i32.store(8, 0, getOut(), mod.i32.const(0)),
      mod.local.set(4, mod.i32.const(0)),
      mod.local.set(5, mod.i32.const(0)),
      mod.block('dec_done', [
        mod.loop('dec_loop', mod.block(null, [
          mod.br_if('dec_done', mod.i32.ge_u(mod.i32.add(getSi(), mod.i32.const(3)), getSlen())),
          // read 4 chars
          mod.local.set(6,  mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), getSi()))),
          mod.local.set(7,  mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.add(getSi(), mod.i32.const(1))))),
          mod.local.set(8,  mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.add(getSi(), mod.i32.const(2))))),
          mod.local.set(9,  mod.i32.load8_u(0, 0, mod.i32.add(srcBytes(), mod.i32.add(getSi(), mod.i32.const(3))))),
          mod.local.set(10, b64val(getC0())),
          mod.local.set(11, b64val(getC1())),
          mod.local.set(12, b64val(getC2())),
          mod.local.set(13, b64val(getC3())),
          // byte0 = (v0<<2) | (v1>>4)
          mod.i32.store8(0, 0, mod.i32.add(outBytes(), getOi()),
            mod.i32.or(mod.i32.shl(getV0(), mod.i32.const(2)), mod.i32.shr_u(getV1(), mod.i32.const(4)))),
          // byte1 = ((v1&0xF)<<4) | (v2>>2) — only if c2 != '='
          mod.if(mod.i32.ne(getC2(), mod.i32.const(61)),
            mod.i32.store8(0, 0, mod.i32.add(outBytes(), mod.i32.add(getOi(), mod.i32.const(1))),
              mod.i32.or(mod.i32.shl(mod.i32.and(getV1(), mod.i32.const(15)), mod.i32.const(4)),
                         mod.i32.shr_u(getV2(), mod.i32.const(2))))),
          // byte2 = ((v2&3)<<6) | v3 — only if c3 != '='
          mod.if(mod.i32.ne(getC3(), mod.i32.const(61)),
            mod.i32.store8(0, 0, mod.i32.add(outBytes(), mod.i32.add(getOi(), mod.i32.const(2))),
              mod.i32.or(mod.i32.shl(mod.i32.and(getV2(), mod.i32.const(3)), mod.i32.const(6)), getV3()))),
          mod.local.set(4, mod.i32.add(getSi(), mod.i32.const(4))),
          mod.local.set(5, mod.i32.add(getOi(), mod.i32.const(3))),
          mod.br('dec_loop'),
        ], none)),
      ]),
      mod.return(getOut()),
    ], i32);
    mod.addFunction('__jswat_base64_decode',
      binaryen.createType([i32]), i32,
      [i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32], body);
  }

  // __jswat_utf8_validate(s:i32) -> i32 (bool)
  // Checks that the str bytes form valid UTF-8 sequences.
  {
    // params: s(0); locals: len(1), i(2), b(3), cont(4)
    const getS    = () => mod.local.get(0, i32);
    const getLen  = () => mod.local.get(1, i32);
    const getI    = () => mod.local.get(2, i32);
    const getB    = () => mod.local.get(3, i32);
    const getCont = () => mod.local.get(4, i32);
    const sBytes  = () => mod.i32.add(getS(), mod.i32.const(12));

    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getS()), mod.return(mod.i32.const(1))), // null → valid
      mod.local.set(1, mod.i32.load(4, 0, getS())),
      mod.local.set(2, mod.i32.const(0)),
      mod.local.set(4, mod.i32.const(0)), // expected continuation bytes
      mod.block('val_done', [
        mod.loop('val_loop', mod.block(null, [
          mod.br_if('val_done', mod.i32.ge_u(getI(), getLen())),
          mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(sBytes(), getI()))),
          mod.if(
            mod.i32.gt_u(getCont(), mod.i32.const(0)),
            // expecting continuation byte: must be 10xxxxxx
            mod.block(null, [
              mod.if(
                mod.i32.ne(mod.i32.and(getB(), mod.i32.const(0xC0)), mod.i32.const(0x80)),
                mod.return(mod.i32.const(0))),
              mod.local.set(4, mod.i32.sub(getCont(), mod.i32.const(1))),
            ], none),
            // lead byte
            mod.if(
              mod.i32.lt_u(getB(), mod.i32.const(0x80)),
              mod.nop(), // ASCII
              mod.if(
                mod.i32.eq(mod.i32.and(getB(), mod.i32.const(0xE0)), mod.i32.const(0xC0)),
                mod.local.set(4, mod.i32.const(1)), // 2-byte
                mod.if(
                  mod.i32.eq(mod.i32.and(getB(), mod.i32.const(0xF0)), mod.i32.const(0xE0)),
                  mod.local.set(4, mod.i32.const(2)), // 3-byte
                  mod.if(
                    mod.i32.eq(mod.i32.and(getB(), mod.i32.const(0xF8)), mod.i32.const(0xF0)),
                    mod.local.set(4, mod.i32.const(3)), // 4-byte
                    mod.return(mod.i32.const(0))        // invalid lead byte
                  )
                )
              )
            )
          ),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          mod.br('val_loop'),
        ], none)),
      ]),
      // valid if no pending continuation bytes
      mod.return(mod.i32.eqz(getCont())),
    ], i32);
    mod.addFunction('__jswat_utf8_validate',
      binaryen.createType([i32]), i32, [i32, i32, i32, i32], body);
  }

  // __jswat_utf8_char_count(s:i32) -> i32 (number of Unicode codepoints)
  {
    // params: s(0); locals: len(1), i(2), b(3), count(4)
    const getS     = () => mod.local.get(0, i32);
    const getLen   = () => mod.local.get(1, i32);
    const getI     = () => mod.local.get(2, i32);
    const getB     = () => mod.local.get(3, i32);
    const getCount = () => mod.local.get(4, i32);
    const sBytes   = () => mod.i32.add(getS(), mod.i32.const(12));

    const body = mod.block(null, [
      mod.if(mod.i32.eqz(getS()), mod.return(mod.i32.const(0))),
      mod.local.set(1, mod.i32.load(4, 0, getS())),
      mod.local.set(2, mod.i32.const(0)),
      mod.local.set(4, mod.i32.const(0)),
      mod.block('cc_done', [
        mod.loop('cc_loop', mod.block(null, [
          mod.br_if('cc_done', mod.i32.ge_u(getI(), getLen())),
          mod.local.set(3, mod.i32.load8_u(0, 0, mod.i32.add(sBytes(), getI()))),
          // count codepoint start bytes: not a UTF-8 continuation byte (10xxxxxx)
          mod.if(
            mod.i32.ne(mod.i32.and(getB(), mod.i32.const(0xC0)), mod.i32.const(0x80)),
            mod.local.set(4, mod.i32.add(getCount(), mod.i32.const(1)))
          ),
          mod.local.set(2, mod.i32.add(getI(), mod.i32.const(1))),
          mod.br('cc_loop'),
        ], none)),
      ]),
      mod.return(getCount()),
    ], i32);
    mod.addFunction('__jswat_utf8_char_count',
      binaryen.createType([i32]), i32, [i32, i32, i32, i32], body);
  }
}
