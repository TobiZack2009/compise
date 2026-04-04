/**
 * @fileoverview Top-level binaryen module generator.
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { buildAllocator } from '../allocator.js';
import { collectStdStubs } from '../std.js';
import { GenContext, toBinType } from './context.js';
import { buildClassLayouts } from './classes.js';
import {
  buildStdStub, buildMemFunctions, buildArrayFunctions, buildStringFunctions,
  buildCollectionsFunctions, buildWasiImports, buildIoFunctions, buildFsFunctions,
  buildClockFunctions, buildRandomFunctions, buildMathFunctions, buildIterFunctions,
  buildPoolFunctions, buildArenaFunctions, buildRcFunctions, buildParseFunctions,
  buildProcessFunctions, buildEncodingFunctions,
} from './runtime.js';
import { astHasArray, buildStringTable, genFunction, genMethod, genConstructor, genStaticMethod } from './functions.js';
import { collectLocals } from './expressions.js';
import { genStatement } from './statements.js';

/**
 * Generate a complete WASM module from a type-annotated Program AST.
 *
 * @param {object} ast  type-annotated acorn Program AST
 * @param {Map<string, object>} signatures
 * @param {Map<string, object>} classes
 * @param {Map} imports
 * @param {string} [filename='<input>']
 * @param {{ stdModules?: Array<{ ast: object, filename: string }>, target?: string, lib?: boolean }} [opts]
 * @returns {{ wat: string, binary: Uint8Array, layoutMap: object }}
 */
export function generateWat(ast, signatures, classes, imports, filename = '<input>', opts = {}) {
  const { stdModules = [], target = 'wasm32-wasip1', lib = false } = opts;
  const isUnknown = target === 'wasm32-unknown';
  const mod = new binaryen.Module();

  // ── Class layouts ─────────────────────────────────────────────────────────
  const layouts = buildClassLayouts(classes);

  // ── String table + memory ─────────────────────────────────────────────────
  const { map: stringMap, segments, size: strSize } = buildStringTable(ast);
  const ioBase = Math.max(Math.ceil(strSize / 16) * 16, 256);

  mod.setMemory(1, 256, 'memory',
    segments.map(s => ({
      data:    s.data,
      offset:  mod.i32.const(s.offset),
      passive: false,
    })));

  // __str_len_out: mutable global used as the len return channel for str-returning
  // functions (fat pointer calling convention — ptr returned normally, len via this global).
  mod.addGlobal('__str_len_out', binaryen.i32, true, mod.i32.const(0));
  mod.addGlobalExport('__str_len_out', '__str_len_out');  // expose to JS for str-returning exports

  // ── Feature detection (must precede table creation) ───────────────────────
  const stdStubs = collectStdStubs(imports);
  const hasArray = astHasArray(ast);

  /** Quick AST walk to detect binary ** operator */
  function astHasPow(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'BinaryExpression' && node.operator === '**') return true;
    return Object.values(node).some(v =>
      Array.isArray(v) ? v.some(astHasPow) : astHasPow(v));
  }

  function astHasStrMethods(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'TemplateLiteral') return true; // template literals use __jswat_str_concat
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const m = node.callee.property?.name;
      if (['slice','indexOf','concat','charAt','startsWith','endsWith','includes','equals'].includes(m) &&
          node.callee.object?._type?.kind === 'str') return true;
    }
    return Object.values(node).some(v =>
      Array.isArray(v) ? v.some(astHasStrMethods) : astHasStrMethods(v));
  }

  // ── Function table ────────────────────────────────────────────────────────
  const fnTable    = [];
  const fnTableMap = new Map();
  for (const [name, sig] of signatures.entries()) {
    const paramTypes  = sig.params.map(p => p.type);
    const returnsI32  = sig.returnType?.wasmType === 'i32';
    const paramsI32   = paramTypes.every(t => t?.wasmType === 'i32');
    if (returnsI32 && paramsI32 && (paramTypes.length === 1 || paramTypes.length === 2)) {
      fnTableMap.set(name, fnTable.length);
      fnTable.push(name);
    }
  }
  const hasIter = Array.from(stdStubs).some(n => n.startsWith('__jswat_iter_'));
  if (fnTable.length > 0 || hasIter) {
    const tableSize = Math.max(fnTable.length, 1);
    mod.addTable('0', tableSize, -1, binaryen.funcref);
    // Element segment added AFTER user functions are defined (see below)
  }
  const fnTypeNames = { 1: '$fn1', 2: '$fn2' };

  const hasIo = stdStubs.has('__jswat_console_log') ||
    stdStubs.has('__jswat_console_error') ||
    stdStubs.has('__jswat_stdout_write')  ||
    stdStubs.has('__jswat_stdout_writeln') ||
    stdStubs.has('__jswat_stderr_write')  ||
    stdStubs.has('__jswat_stdin_read')    ||
    stdStubs.has('__jswat_stdin_read_line') ||
    stdStubs.has('__jswat_stdin_read_all');

  const hasFs = stdStubs.has('__jswat_fs_read')   ||
    stdStubs.has('__jswat_fs_write')  ||
    stdStubs.has('__jswat_fs_append') ||
    stdStubs.has('__jswat_fs_exists') ||
    stdStubs.has('__jswat_fs_delete') ||
    stdStubs.has('__jswat_fs_mkdir')  ||
    stdStubs.has('__jswat_fs_readdir');

  const hasClock = stdStubs.has('__jswat_clock_now') ||
    stdStubs.has('__jswat_clock_monotonic') ||
    stdStubs.has('__jswat_clock_sleep');

  const hasRandom = stdStubs.has('__jswat_random_float') ||
    stdStubs.has('__jswat_random_seed');

  const hasMem = Array.from(stdStubs).some(n =>
    n.startsWith('__jswat_alloc_') || n.startsWith('__jswat_ptr_'));

  const hasString = Array.from(stdStubs).some(n => n.startsWith('__jswat_string_') || n.startsWith('__jswat_str_')) ||
    astHasStrMethods(ast);

  const hasCollections = Array.from(stdStubs).some(n =>
    n.startsWith('__jswat_map_')   ||
    n.startsWith('__jswat_set_')   ||
    n.startsWith('__jswat_queue_') ||
    n.startsWith('__jswat_stack_') ||
    n.startsWith('__jswat_deque_'));

  const hasMath = Array.from(stdStubs).some(n => n.startsWith('__jswat_math_')) ||
    astHasPow(ast);

  // Pool / arena: detect from std module @external declarations in signatures
  const hasPool = Array.from(signatures.values()).some(sig => sig.external?.name?.startsWith('__jswat_pool_'));
  const hasArena = Array.from(signatures.values()).some(sig => sig.external?.name?.startsWith('__jswat_arena_'));

  const hasProcess  = Array.from(stdStubs).some(n => n.startsWith('__jswat_process_'));
  const hasEncoding = Array.from(stdStubs).some(n =>
    n.startsWith('__jswat_base64_') || n.startsWith('__jswat_utf8_'));

  // ── WASI imports ──────────────────────────────────────────────────────────
  if (!isUnknown) buildWasiImports(mod, hasIo, hasFs, hasClock, hasRandom, hasProcess);

  // ── @external imports from std modules ────────────────────────────────────
  // Track already-imported names to avoid duplicates (binaryen throws on dupes)
  /** @type {Set<string>} */
  const importedFunctions = new Set();
  for (const { ast: stdAst } of stdModules) {
    for (const node of stdAst.body) {
      if (node.type !== 'FunctionDeclaration' || !node._externalModule) continue;
      // Skip __jswat_runtime — those are built by runtime.js, not host imports
      if (node._externalModule === '__jswat_runtime') continue;
      const internalName = node.id?.name;
      if (!internalName || importedFunctions.has(internalName)) continue;
      const sig = signatures.get(internalName);
      if (!sig) continue;
      importedFunctions.add(internalName);
      mod.addFunctionImport(
        internalName,
        node._externalModule,
        node._externalName ?? internalName,
        binaryen.createType(sig.params.map(p => toBinType(p.type))),
        toBinType(sig.returnType)
      );
    }
  }

  // ── Allocator ─────────────────────────────────────────────────────────────
  buildAllocator(mod);

  // ── RC runtime (always present — any class instantiation uses it) ─────────
  buildRcFunctions(mod);
  buildParseFunctions(mod);

  // ── Runtime functions ─────────────────────────────────────────────────────
  if (!isUnknown && hasIo)     buildIoFunctions(mod, ioBase);
  if (!isUnknown && hasFs)     buildFsFunctions(mod, ioBase + 64);
  if (!isUnknown && hasClock)  buildClockFunctions(mod, ioBase + 128);
  if (!isUnknown && hasRandom) buildRandomFunctions(mod, ioBase + 192);
  if (hasMem)         buildMemFunctions(mod);
  if (hasString)      buildStringFunctions(mod);
  if (hasArray)       buildArrayFunctions(mod);
  if (hasCollections) buildCollectionsFunctions(mod);
  if (hasMath)        buildMathFunctions(mod);
  if (hasIter)        { if (!hasArray) buildArrayFunctions(mod); buildIterFunctions(mod); }
  if (hasPool)        buildPoolFunctions(mod);
  if (hasArena)       buildArenaFunctions(mod);
  if (hasProcess)     buildProcessFunctions(mod, isUnknown);
  if (hasEncoding)    buildEncodingFunctions(mod);

  // ── Std stubs (no-ops for unused imports) ─────────────────────────────────
  for (const stub of stdStubs) {
    if (hasIo && !isUnknown && (stub.includes('console') || stub.includes('stdout') ||
                  stub.includes('stderr')  || stub.includes('stdin'))) continue;
    if (hasFs   && !isUnknown && stub.startsWith('__jswat_fs_'))       continue;
    if (hasClock  && !isUnknown && stub.startsWith('__jswat_clock_'))  continue;
    if (hasRandom && !isUnknown && stub.startsWith('__jswat_random_')) continue;
    if (hasMem  && (stub.startsWith('__jswat_alloc_') || stub.startsWith('__jswat_ptr_'))) continue;
    if (hasString && stub.startsWith('__jswat_string_')) continue;
    if (hasCollections && (
      stub.startsWith('__jswat_map_')   ||
      stub.startsWith('__jswat_set_')   ||
      stub.startsWith('__jswat_queue_') ||
      stub.startsWith('__jswat_stack_') ||
      stub.startsWith('__jswat_deque_')
    )) continue;
    if (hasMath     && stub.startsWith('__jswat_math_'))    continue;
    if (hasIter     && stub.startsWith('__jswat_iter_'))    continue;
    if (hasProcess  && stub.startsWith('__jswat_process_')) continue;
    if (hasEncoding && (stub.startsWith('__jswat_base64_') || stub.startsWith('__jswat_utf8_'))) continue;
    buildStdStub(mod, stub);
  }

  // ── Runtime wrappers for @external("__jswat_runtime", ...) std functions ──
  // Std class methods call the internal name (e.g. `__console_log`), but the
  // runtime provides the external name (e.g. `__jswat_console_log`).  Add a
  // thin wrapper so that calls from compiled std class methods resolve.
  // Skip wrapper if the runtime already added a function with the same internal name
  // (e.g., allocator adds `__alloc` directly, so no wrapper needed for std/mem.js's
  // function __alloc @external("__jswat_runtime","__jswat_alloc")).
  /** @type {Set<string>} */
  const runtimeWrappers = new Set();
  for (const { ast: stdAst } of stdModules) {
    for (const node of stdAst.body) {
      if (node.type !== 'FunctionDeclaration' || !node._externalModule) continue;
      if (node._externalModule !== '__jswat_runtime') continue;
      const internalName = node.id?.name;
      const externalName = node._externalName;
      if (!internalName || !externalName || runtimeWrappers.has(internalName)) continue;
      const sig = signatures.get(internalName);
      if (!sig) continue;
      runtimeWrappers.add(internalName);
      // Skip if a function with this internal name was already added by a build* function
      // (binaryen.getFunction returns a non-zero handle if it exists)
      try {
        const exists = mod.getFunction(internalName);
        if (exists) continue; // already provided by runtime
      } catch (_) { /* getFunction not available or other error — proceed */ }
      // Expand str params: each str becomes (ptr:i32, len:i32) per fat-pointer convention.
      const expandedTypes = [];
      for (const p of sig.params) {
        expandedTypes.push(toBinType(p.type));
        if (p.type?.kind === 'str') expandedTypes.push(binaryen.i32); // len
      }
      const retType = toBinType(sig.returnType);
      if (isUnknown) {
        // wasm32-unknown: emit a no-op stub directly — no WASI external to call
        const body = retType === binaryen.none ? mod.nop()
                   : mod.return(retType === binaryen.f64 ? mod.f64.const(0)
                              : retType === binaryen.f32 ? mod.f32.const(0)
                              : retType === binaryen.i64 ? mod.i64.const(0, 0)
                              : mod.i32.const(0));
        mod.addFunction(internalName, binaryen.createType(expandedTypes), retType, [], body);
        continue;
      }
      const paramRefs = expandedTypes.map((t, i) => mod.local.get(i, t));
      const callExpr  = mod.call(externalName, paramRefs, retType);
      const body      = retType === binaryen.none ? callExpr : mod.return(callExpr);
      mod.addFunction(internalName,
        binaryen.createType(expandedTypes), retType, [], body);
    }
  }

  // ── Std functions (non-@external, compiled from std module ASTs) ─────────
  const stringTable = { map: stringMap };

  for (const { ast: stdAst, filename: stdFile } of stdModules) {
    for (const node of stdAst.body) {
      if (node.type !== 'FunctionDeclaration') continue;
      if (node._externalModule) continue; // @external — already handled above
      genFunction(node, mod, signatures, classes, layouts, imports,
        stringTable, stdFile, fnTableMap, fnTypeNames);
    }
  }

  // ── User functions ────────────────────────────────────────────────────────

  for (const node of ast.body) {
    if (node.type !== 'FunctionDeclaration') continue;
    genFunction(node, mod, signatures, classes, layouts, imports,
      stringTable, filename, fnTableMap, fnTypeNames);
  }

  // Add WASM globals for static fields
  for (const classInfo of classes.values()) {
    for (const [fieldName, fieldType] of (classInfo.staticFields ?? new Map()).entries()) {
      const globalName = `${classInfo.name}__sf_${fieldName}`;
      // All static fields are mutable i32 globals (pointers/ints/bools all fit in i32)
      // Initial value 0 (false/null); for bool false, i32 float fields would need special handling
      let initVal = mod.i32.const(0);
      if (fieldType?.wasmType === 'f64') {
        // Can't have f64 global with i32 — store as i32 bits or just use i32
        // For simplicity, static f64 fields stored as i32 (limitation)
      }
      mod.addGlobal(globalName, binaryen.i32, true, initVal);
    }
  }

  // ── Built-in class constructors (direct binaryen, no AST) ────────────────
  if (classes.has('IteratorResult')) {
    const irLayout = layouts.get('IteratorResult');
    const valOff  = irLayout?.fields.get('value')?.offset ?? 12;
    const doneOff = irLayout?.fields.get('done')?.offset  ?? 16;
    mod.addFunction('IteratorResult__ctor',
      binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]),
      binaryen.none, [],
      mod.block(null, [
        mod.i32.store(valOff,  0, mod.local.get(0, binaryen.i32), mod.local.get(1, binaryen.i32)),
        mod.i32.store8(doneOff, 0, mod.local.get(0, binaryen.i32), mod.local.get(2, binaryen.i32)),
      ], binaryen.none)
    );
  }

  for (const classInfo of classes.values()) {
    for (const [methodName, method] of classInfo.methods.entries()) {
      genMethod(classInfo, methodName, method.node, method.signature,
        mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames);
    }
    if (classInfo.constructor && !classInfo.constructor._builtin) {
      genConstructor(classInfo, classInfo.constructor.node, classInfo.constructor.signature,
        mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames);
    }
    for (const [methodName, method] of (classInfo.staticMethods ?? new Map()).entries()) {
      genStaticMethod(classInfo, methodName, method.node, method.signature,
        mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames, false);
    }
    for (const [getterName, getter] of (classInfo.staticGetters ?? new Map()).entries()) {
      genStaticMethod(classInfo, getterName, getter.node, getter.signature,
        mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames, true);
    }
  }

  // ── Function table element segment (after functions are defined) ─────────
  if (fnTable.length > 0) {
    mod.addActiveElementSegment('0', 'elems', fnTable, mod.i32.const(0));
  }

  // ── Top-level statements → __start / _start (or __jswat_init for lib/unknown) ──
  const topLevelStmts = ast.body.filter(n =>
    n.type !== 'FunctionDeclaration' &&
    n.type !== 'ClassDeclaration'    &&
    n.type !== 'ImportDeclaration'
  );

  if (topLevelStmts.length > 0 && !lib) {
    const fakeBlock = { type: 'BlockStatement', body: topLevelStmts };
    const { locals, heapLocals: startHeapLocals } = collectLocals(fakeBlock, []);

    const startCtx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
    startCtx._strings = stringMap;
    startCtx._heapLocals = startHeapLocals;
    startCtx.setLocals([], locals);

    const bodyStmts = topLevelStmts.map(stmt => genStatement(stmt, TYPES.void, startCtx, filename));
    const startBody = bodyStmts.length === 0 ? mod.nop()
                    : bodyStmts.length === 1 ? bodyStmts[0]
                    : mod.block(null, bodyStmts, binaryen.none);

    mod.addFunction('__start',
      binaryen.createType([]), binaryen.none,
      startCtx._varTypes, startBody);
    mod.addFunctionExport('__start', '__start');

    if (isUnknown) {
      // wasm32-unknown: export __jswat_init instead of _start
      mod.addFunction('__jswat_init',
        binaryen.createType([]), binaryen.none, [],
        mod.call('__start', [], binaryen.none));
      mod.addFunctionExport('__jswat_init', '__jswat_init');
    } else {
      mod.addFunction('_start',
        binaryen.createType([]), binaryen.none, [],
        mod.call('__start', [], binaryen.none));
      mod.addFunctionExport('_start', '_start');
    }
  }

  // ── Emit ──────────────────────────────────────────────────────────────────
  mod.setFeatures(binaryen.Features.BulkMemory | binaryen.Features.MutableGlobals);
  const wat    = mod.emitText();
  const binary = mod.emitBinary();
  mod.dispose();

  // ── Build layoutMap for --emit-layout ─────────────────────────────────────
  const layoutMap = {};
  for (const [name, layout] of layouts.entries()) {
    layoutMap[name] = {
      size: layout.size,
      classId: layout.classId,
      fields: Object.fromEntries(
        Array.from(layout.fields.entries()).map(([fn, fi]) => [fn, { offset: fi.offset, type: fi.type?.name ?? fi.type?.kind ?? 'i32' }])
      ),
    };
  }

  return { wat, binary, layoutMap };
}
