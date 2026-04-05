/**
 * @fileoverview Function-level code generation: genFunction, genMethod, genConstructor,
 * plus AST utilities: astHasArray, buildStringTable, bytesToWatString.
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { CodegenError, GenContext, toBinType } from './context.js';

/**
 * Expand str-typed params to two WASM params each: name (ptr) and name__len (len).
 * This reflects the str fat-pointer calling convention: each str param becomes
 * two i32 WASM params.
 * @param {Array<{ name: string, type: import('../types.js').TypeInfo }>} params
 * @returns {Array<{ name: string, type: import('../types.js').TypeInfo }>}
 */
export function expandStrParams(params) {
  const result = [];
  for (const p of params) {
    result.push(p);
    if (p.type?.kind === 'str') {
      result.push({ name: p.name + '__len', type: TYPES.isize });
    }
  }
  return result;
}
import { collectLocals } from './expressions.js';
import { genStatement, genHeapCleanup } from './statements.js';

/**
 * Detect array usage in the AST.
 * @param {object} ast
 * @returns {boolean}
 */
export function astHasArray(ast) {
  let found = false;
  /** @param {object} node */
  function visit(node) {
    if (!node || found) return;
    if (node.type === 'ArrayExpression') { found = true; return; }
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
  return found;
}

/**
 * Build string data segments and address map.
 *
 * Fat-pointer layout (spec §str): string literals are raw UTF-8 bytes in the
 * WASM data segment — NO header.  The str fat pointer carries (ptr, len) as
 * two separate i32 values; ptr points directly at the first byte.
 *
 * Memory map:
 *   [0..3]  reserved null-sentinel region — ptr=0 means null str
 *   [4..]   string bytes, packed with 4-byte alignment between entries
 *
 * @param {object} ast
 * @returns {{ map: Map<string, {ptr:number, len:number}>, segments: Array<{data: Uint8Array, offset: number}>, size: number }}
 */
export function buildStringTable(ast) {
  const encoder = new TextEncoder();
  const strings = new Map();
  // Reserve address 0 as null sentinel; first real string starts at 4.
  // Even empty string "" gets ptr=4, len=0 (non-null, zero length).
  let offset = 4;

  /** @param {object} node */
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
      if (!strings.has(node.value)) {
        const bytes = encoder.encode(node.value);
        strings.set(node.value, { offset, bytes, len: bytes.length });
        offset += bytes.length;
        // Align to 4 bytes for the next string
        if (offset % 4 !== 0) offset += 4 - (offset % 4);
      }
    }
    // Also collect template literal quasi (static) strings
    if (node.type === 'TemplateElement') {
      const cooked = node.value?.cooked ?? '';
      if (!strings.has(cooked)) {
        const bytes = encoder.encode(cooked);
        strings.set(cooked, { offset, bytes, len: bytes.length });
        offset += bytes.length;
        if (offset % 4 !== 0) offset += 4 - (offset % 4);
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

  const segments = [];
  const map = new Map();
  for (const [value, info] of strings.entries()) {
    map.set(value, { ptr: info.offset, len: info.len });
    if (info.len > 0) {
      // Only emit a data segment if there are actual bytes to write
      segments.push({ data: info.bytes, offset: info.offset });
    }
  }
  return { map, segments, size: offset };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToWatString(bytes) {
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
 * Generate and add a function to the binaryen module.
 * @param {object} node  FunctionDeclaration AST node
 * @param {any} mod  binaryen Module
 * @param {Map<string, FunctionSignature>} signatures
 * @param {Map<string, import('../typecheck.js').ClassInfo>} classes
 * @param {Map} layouts
 * @param {Map} imports
 * @param {{ map: Map<string, number> }} stringTable
 * @param {string} filename
 * @param {Map<string, number>|null} fnTableMap
 * @param {object|null} fnTypeNames
 */
export function genFunction(node, mod, signatures, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames) {
  const name = node.id.name;
  const sig  = signatures.get(name);
  if (!sig) throw new CodegenError(`No signature for function '${name}' (${filename})`);

  // Expand str params to two WASM params each (ptr + len).
  const params    = expandStrParams(sig.params.map(p => ({ name: p.name, type: p.type })));
  const { locals: localVars, heapLocals } = collectLocals(node.body, params, sig.returnType);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx._heapLocals = heapLocals;
  ctx.setLocals(params, localVars);

  const bodyStmts = node.body.body.map(stmt => genStatement(stmt, sig.returnType, ctx, filename));
  // End-of-body cleanup for void functions (non-void always have explicit returns)
  if (heapLocals.size > 0 && (!sig.returnType || sig.returnType.wasmType === '')) {
    bodyStmts.push(...genHeapCleanup(ctx, null));
  }
  const bodyExpr  = bodyStmts.length === 0 ? mod.nop()
                  : bodyStmts.length === 1 ? bodyStmts[0]
                  : mod.block(null, bodyStmts, binaryen.none);

  const paramType  = binaryen.createType(params.map(p => toBinType(p.type)));
  const resultType = toBinType(sig.returnType);

  mod.addFunction(name, paramType, resultType, ctx._varTypes, bodyExpr);
  if (node._exportName !== undefined) {
    mod.addFunctionExport(name, node._exportName ?? name);
  }
}

/**
 * Generate and add a class method to the binaryen module.
 * @param {import('../typecheck.js').ClassInfo} classInfo
 * @param {string} methodName
 * @param {object} fnNode
 * @param {FunctionSignature} sig
 * @param {any} mod  binaryen Module
 * @param {Map<string, import('../typecheck.js').ClassInfo>} classes
 * @param {Map} layouts
 * @param {Map} imports
 * @param {{ map: Map<string, number> }} stringTable
 * @param {string} filename
 * @param {Map<string, number>|null} fnTableMap
 * @param {object|null} fnTypeNames
 */
export function genMethod(classInfo, methodName, fnNode, sig, mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames) {
  const name   = `${classInfo.name}_${methodName}`;
  const params = expandStrParams([{ name: 'this', type: classInfo.type }, ...sig.params.map(p => ({ name: p.name, type: p.type }))]);
  const { locals: localVars, heapLocals } = collectLocals(fnNode.body, params, sig.returnType);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx._heapLocals = heapLocals;
  ctx.setLocals(params, localVars);

  const bodyStmts = fnNode.body.body.map(stmt => genStatement(stmt, sig.returnType, ctx, filename));
  // End-of-body cleanup for void methods (non-void always have explicit returns)
  if (heapLocals.size > 0 && (!sig.returnType || sig.returnType.wasmType === '')) {
    bodyStmts.push(...genHeapCleanup(ctx, null));
  }
  const bodyExpr  = bodyStmts.length === 0 ? mod.nop()
                  : bodyStmts.length === 1 ? bodyStmts[0]
                  : mod.block(null, bodyStmts, binaryen.none);

  const paramType  = binaryen.createType(params.map(p => toBinType(p.type)));
  const resultType = toBinType(sig.returnType);

  mod.addFunction(name, paramType, resultType, ctx._varTypes, bodyExpr);
  // Methods are not exported individually (they're called internally)
}

/**
 * Generate and add a class constructor to the binaryen module.
 * @param {import('../typecheck.js').ClassInfo} classInfo
 * @param {object} fnNode
 * @param {FunctionSignature} sig
 * @param {any} mod  binaryen Module
 * @param {Map<string, import('../typecheck.js').ClassInfo>} classes
 * @param {Map} layouts
 * @param {Map} imports
 * @param {{ map: Map<string, number> }} stringTable
 * @param {string} filename
 * @param {Map<string, number>|null} fnTableMap
 * @param {object|null} fnTypeNames
 */
export function genConstructor(classInfo, fnNode, sig, mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames) {
  const name   = `${classInfo.name}__ctor`;
  const params = expandStrParams([{ name: 'this', type: classInfo.type }, ...sig.params.map(p => ({ name: p.name, type: p.type }))]);
  const { locals: localVars, heapLocals } = collectLocals(fnNode.body, params, null);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx._currentClassInfo = classInfo;
  ctx._heapLocals = heapLocals;
  ctx.setLocals(params, localVars);

  const bodyStmts = fnNode.body.body.map(stmt => genStatement(stmt, TYPES.void, ctx, filename));
  // Constructors are always void — add end-of-body heap cleanup
  if (heapLocals.size > 0) bodyStmts.push(...genHeapCleanup(ctx, null));
  const bodyExpr  = bodyStmts.length === 0 ? mod.nop()
                  : bodyStmts.length === 1 ? bodyStmts[0]
                  : mod.block(null, bodyStmts, binaryen.none);

  const paramType  = binaryen.createType(params.map(p => toBinType(p.type)));
  // Constructor returns void
  mod.addFunction(name, paramType, binaryen.none, ctx._varTypes, bodyExpr);
}

/**
 * Generate and add a static class method to the binaryen module.
 * Static methods have no 'this' parameter.
 */
export function genStaticMethod(classInfo, methodName, fnNode, sig, mod, classes, layouts, imports, stringTable, filename, fnTableMap, fnTypeNames, isGetter) {
  const suffix = isGetter ? `__sg_${methodName}` : `__sm_${methodName}`;
  const name = `${classInfo.name}${suffix}`;
  const params = expandStrParams(sig.params.map(p => ({ name: p.name, type: p.type })));
  const { locals: localVars, heapLocals } = collectLocals(fnNode.body, params, sig.returnType);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx._currentClassInfo = classInfo;
  ctx._heapLocals = heapLocals;
  ctx.setLocals(params, localVars);

  const bodyStmts = fnNode.body.body.map(stmt => genStatement(stmt, sig.returnType, ctx, filename));
  if (heapLocals.size > 0 && (!sig.returnType || sig.returnType.wasmType === '')) {
    bodyStmts.push(...genHeapCleanup(ctx, null));
  }
  const bodyExpr  = bodyStmts.length === 0 ? mod.nop()
                  : bodyStmts.length === 1 ? bodyStmts[0]
                  : mod.block(null, bodyStmts, binaryen.none);

  const paramType  = binaryen.createType(params.map(p => toBinType(p.type)));
  const resultType = toBinType(sig.returnType);

  mod.addFunction(name, paramType, resultType, ctx._varTypes, bodyExpr);
}
