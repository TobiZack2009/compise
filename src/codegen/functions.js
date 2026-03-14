/**
 * @fileoverview Function-level code generation: genFunction, genMethod, genConstructor,
 * plus AST utilities: astHasArray, buildStringTable, bytesToWatString.
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { CodegenError, GenContext, toBinType } from './context.js';
import { collectLocals } from './expressions.js';
import { genStatement } from './statements.js';

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
 * Layout: [len:4][hash:4][bytes...]
 * @param {object} ast
 * @returns {{ map: Map<string, number>, segments: Array<{data: Uint8Array, offset: number}>, size: number }}
 */
export function buildStringTable(ast) {
  const encoder = new TextEncoder();
  const strings = new Map();
  let offset = 8;  // Reserve address 0 as null pointer sentinel

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

  const segments = [];
  const map = new Map();
  for (const [value, info] of strings.entries()) {
    map.set(value, info.offset);
    const bytes = new Uint8Array(8 + info.len);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, info.len, true);
    dv.setUint32(4, 0, true);
    bytes.set(info.bytes, 8);
    segments.push({ data: bytes, offset: info.offset });
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

  const params    = sig.params.map(p => ({ name: p.name, type: p.type }));
  const localVars = collectLocals(node.body, sig.params);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx.setLocals(params, localVars);

  const bodyStmts = node.body.body.map(stmt => genStatement(stmt, sig.returnType, ctx, filename));
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
  const params = [{ name: 'this', type: classInfo.type }, ...sig.params.map(p => ({ name: p.name, type: p.type }))];
  const localVars = collectLocals(fnNode.body, params);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx.setLocals(params, localVars);

  const bodyStmts = fnNode.body.body.map(stmt => genStatement(stmt, sig.returnType, ctx, filename));
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
  const params = [{ name: 'this', type: classInfo.type }, ...sig.params.map(p => ({ name: p.name, type: p.type }))];
  const localVars = collectLocals(fnNode.body, params);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx._currentClassInfo = classInfo;
  ctx.setLocals(params, localVars);

  const bodyStmts = fnNode.body.body.map(stmt => genStatement(stmt, TYPES.void, ctx, filename));
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
  const params = sig.params.map(p => ({ name: p.name, type: p.type }));
  const localVars = collectLocals(fnNode.body, params);

  const ctx = new GenContext(mod, classes, layouts, imports, fnTableMap, fnTypeNames);
  ctx._strings = stringTable.map;
  ctx._currentClassInfo = classInfo;
  ctx.setLocals(params, localVars);

  const bodyStmts = fnNode.body.body.map(stmt => genStatement(stmt, sig.returnType, ctx, filename));
  const bodyExpr  = bodyStmts.length === 0 ? mod.nop()
                  : bodyStmts.length === 1 ? bodyStmts[0]
                  : mod.block(null, bodyStmts, binaryen.none);

  const paramType  = binaryen.createType(params.map(p => toBinType(p.type)));
  const resultType = toBinType(sig.returnType);

  mod.addFunction(name, paramType, resultType, ctx._varTypes, bodyExpr);
}
