/**
 * @fileoverview Top-level binaryen module generator.
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { buildAllocator } from '../allocator.js';
import { collectStdStubs } from '../std.js';
import { GenContext } from './context.js';
import { buildClassLayouts } from './classes.js';
import {
  buildStdStub, buildMemFunctions, buildArrayFunctions, buildStringFunctions,
  buildCollectionsFunctions, buildWasiImports, buildIoFunctions, buildFsFunctions,
  buildClockFunctions, buildRandomFunctions, buildMathFunctions, buildIterFunctions,
} from './runtime.js';
import { astHasArray, buildStringTable, genFunction, genMethod, genConstructor } from './functions.js';
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
 * @returns {{ wat: string, binary: Uint8Array }}
 */
export function generateWat(ast, signatures, classes, imports, filename = '<input>') {
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

  // ── WASI imports ──────────────────────────────────────────────────────────
  buildWasiImports(mod, hasIo, hasFs, hasClock, hasRandom);

  // ── Allocator ─────────────────────────────────────────────────────────────
  buildAllocator(mod);

  // ── Runtime functions ─────────────────────────────────────────────────────
  if (hasIo)          buildIoFunctions(mod, ioBase);
  if (hasFs)          buildFsFunctions(mod, ioBase + 64);
  if (hasClock)       buildClockFunctions(mod, ioBase + 128);
  if (hasRandom)      buildRandomFunctions(mod, ioBase + 192);
  if (hasMem)         buildMemFunctions(mod);
  if (hasString)      buildStringFunctions(mod);
  if (hasArray)       buildArrayFunctions(mod);
  if (hasCollections) buildCollectionsFunctions(mod);
  if (hasMath)        buildMathFunctions(mod);
  if (hasIter)        { if (!hasArray) buildArrayFunctions(mod); buildIterFunctions(mod); }

  // ── Std stubs (no-ops for unused imports) ─────────────────────────────────
  for (const stub of stdStubs) {
    if (hasIo && (stub.includes('console') || stub.includes('stdout') ||
                  stub.includes('stderr')  || stub.includes('stdin'))) continue;
    if (hasFs   && stub.startsWith('__jswat_fs_'))       continue;
    if (hasClock  && stub.startsWith('__jswat_clock_'))  continue;
    if (hasRandom && stub.startsWith('__jswat_random_')) continue;
    if (hasMem  && (stub.startsWith('__jswat_alloc_') || stub.startsWith('__jswat_ptr_'))) continue;
    if (hasString && stub.startsWith('__jswat_string_')) continue;
    if (hasCollections && (
      stub.startsWith('__jswat_map_')   ||
      stub.startsWith('__jswat_set_')   ||
      stub.startsWith('__jswat_queue_') ||
      stub.startsWith('__jswat_stack_') ||
      stub.startsWith('__jswat_deque_')
    )) continue;
    if (hasMath && stub.startsWith('__jswat_math_')) continue;
    if (hasIter && stub.startsWith('__jswat_iter_')) continue;
    buildStdStub(mod, stub);
  }

  // ── User functions ────────────────────────────────────────────────────────
  const stringTable = { map: stringMap };

  for (const node of ast.body) {
    if (node.type !== 'FunctionDeclaration') continue;
    genFunction(node, mod, signatures, classes, layouts, imports,
      stringTable, filename, fnTableMap, fnTypeNames);
  }

  for (const classInfo of classes.values()) {
    for (const [methodName, method] of classInfo.methods.entries()) {
      genMethod(classInfo, methodName, method.node, method.signature,
        mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames);
    }
    if (classInfo.constructor) {
      genConstructor(classInfo, classInfo.constructor.node, classInfo.constructor.signature,
        mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames);
    }
  }

  // ── Function table element segment (after functions are defined) ─────────
  if (fnTable.length > 0) {
    mod.addActiveElementSegment('0', 'elems', fnTable, mod.i32.const(0));
  }

  // ── Top-level statements → __start / _start ───────────────────────────────
  const topLevelStmts = ast.body.filter(n =>
    n.type !== 'FunctionDeclaration' &&
    n.type !== 'ClassDeclaration'    &&
    n.type !== 'ImportDeclaration'
  );

  if (topLevelStmts.length > 0) {
    const fakeBlock = { type: 'BlockStatement', body: topLevelStmts };
    const locals    = collectLocals(fakeBlock, []);

    const startCtx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
    startCtx._strings = stringMap;
    startCtx.setLocals([], locals);

    const bodyStmts = topLevelStmts.map(stmt => genStatement(stmt, TYPES.void, startCtx, filename));
    const startBody = bodyStmts.length === 0 ? mod.nop()
                    : bodyStmts.length === 1 ? bodyStmts[0]
                    : mod.block(null, bodyStmts, binaryen.none);

    mod.addFunction('__start',
      binaryen.createType([]), binaryen.none,
      startCtx._varTypes, startBody);
    mod.addFunctionExport('__start', '__start');

    mod.addFunction('_start',
      binaryen.createType([]), binaryen.none, [],
      mod.call('__start', [], binaryen.none));
    mod.addFunctionExport('_start', '_start');
  }

  // ── Emit ──────────────────────────────────────────────────────────────────
  const wat    = mod.emitText();
  const binary = mod.emitBinary();
  mod.dispose();

  return { wat, binary };
}
