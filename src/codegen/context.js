/**
 * @fileoverview CodegenError class and GenContext class.
 */

import binaryen from 'binaryen';

/**
 * @typedef {import('../types.js').TypeInfo} TypeInfo
 */

export class CodegenError extends Error {
  /** @param {string} msg */
  constructor(msg) { super(msg); this.name = 'CodegenError'; }
}

/**
 * Convert a TypeInfo to a binaryen type number.
 * @param {TypeInfo|undefined|null} typeInfo
 * @returns {number} binaryen type
 */
export function toBinType(typeInfo) {
  if (!typeInfo) return binaryen.i32;
  switch (typeInfo.wasmType) {
    case '':    return binaryen.none;  // void
    case 'i32': return binaryen.i32;
    case 'i64': return binaryen.i64;
    case 'f32': return binaryen.f32;
    case 'f64': return binaryen.f64;
    default:    return binaryen.i32;   // class refs, pointers, etc.
  }
}

// ── Codegen context ─────────────────────────────────────────────────────────

export class GenContext {
  /**
   * @param {any} mod  binaryen Module
   * @param {Map<string, import('../typecheck.js').ClassInfo>|null} classes
   * @param {Map<string, { size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>} layouts
   * @param {Map<string, { kind: string, module: string, name: string }>|null} imports
   * @param {Map<string, number>|null} fnTableMap
   * @param {object|null} fnTypeNames
   */
  constructor(mod, classes, layouts, imports, fnTableMap = null, fnTypeNames = null) {
    this.mod = mod;
    this._label = 0;
    /** @type {Array<{ breakLabel: string, continueLabel: string }>} */
    this._loopStack = [];
    this._classes = classes;
    this._layouts = layouts;
    this._imports = imports;
    this._fnTableMap = fnTableMap;
    this._fnTypeNames = fnTypeNames;
    /** @type {Map<string, { index: number, binType: number }>} */
    this._localMap = new Map();
    /** @type {number[]} local var types (not counting params) */
    this._varTypes = [];
  }

  /**
   * Set up locals from params and local variables.
   * @param {Array<{ name: string, type: TypeInfo }>} params
   * @param {Array<{ name: string, type: TypeInfo }>} localVars
   */
  setLocals(params, localVars) {
    this._localMap = new Map();
    this._varTypes = [];
    let idx = 0;
    for (const p of params) {
      const binType = toBinType(p.type);
      this._localMap.set(p.name, { index: idx, binType });
      idx++;
    }
    for (const v of localVars) {
      const binType = toBinType(v.type);
      this._localMap.set(v.name, { index: idx, binType });
      this._varTypes.push(binType);
      idx++;
    }
  }

  /**
   * Get a local by name.
   * @param {string} name
   * @returns {number} ExpressionRef
   */
  localGet(name) {
    const info = this._localMap.get(name);
    if (!info) {
      // Fallback: return i32 const 0 to avoid crashes (should not happen if typechecked)
      return this.mod.i32.const(0);
    }
    return this.mod.local.get(info.index, info.binType);
  }

  /**
   * Set a local by name.
   * @param {string} name
   * @param {number} value  ExpressionRef
   * @returns {number} ExpressionRef
   */
  localSet(name, value) {
    const info = this._localMap.get(name);
    if (!info) return this.mod.drop(value);
    return this.mod.local.set(info.index, value);
  }

  /**
   * Tee a local by name (set and return value).
   * @param {string} name
   * @param {number} value  ExpressionRef
   * @returns {number} ExpressionRef
   */
  localTee(name, value) {
    const info = this._localMap.get(name);
    if (!info) return value;
    return this.mod.local.tee(info.index, value, info.binType);
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
