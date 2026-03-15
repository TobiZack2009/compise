/**
 * @fileoverview Type helpers: typeSize, resolveFieldType, genLoad, genStore,
 * genBinOp, genCast, maybeNarrow.
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { CodegenError } from './context.js';

/**
 * @typedef {import('../types.js').TypeInfo} TypeInfo
 */

/**
 * @param {TypeInfo|undefined} typeInfo
 * @returns {number}
 */
export function typeSize(typeInfo) {
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
export function resolveFieldType(typeInfo) {
  if (!typeInfo || typeInfo.kind === 'unknown') return TYPES.isize;
  return typeInfo;
}

/**
 * Generate a load expression for reading a field.
 * @param {any} mod  binaryen Module
 * @param {number} ptr  ExpressionRef for the pointer
 * @param {TypeInfo} typeInfo
 * @param {number} [offset=0]
 * @returns {number} ExpressionRef
 */
export function genLoad(mod, ptr, typeInfo, offset = 0) {
  const t = resolveFieldType(typeInfo);
  if (t.name === 'i8')  return mod.i32.load8_s(offset, 0, ptr);
  if (t.name === 'u8' || t.kind === 'bool') return mod.i32.load8_u(offset, 0, ptr);
  if (t.name === 'i16') return mod.i32.load16_s(offset, 0, ptr);
  if (t.name === 'u16') return mod.i32.load16_u(offset, 0, ptr);
  if (t.wasmType === 'i64') return mod.i64.load(offset, 0, ptr);
  if (t.wasmType === 'f32') return mod.f32.load(offset, 0, ptr);
  if (t.wasmType === 'f64') return mod.f64.load(offset, 0, ptr);
  return mod.i32.load(offset, 0, ptr);
}

/**
 * Generate a store expression for writing a field.
 * @param {any} mod  binaryen Module
 * @param {number} ptr  ExpressionRef for the pointer
 * @param {number} value  ExpressionRef for the value
 * @param {TypeInfo} typeInfo
 * @param {number} [offset=0]
 * @returns {number} ExpressionRef
 */
export function genStore(mod, ptr, value, typeInfo, offset = 0) {
  const t = resolveFieldType(typeInfo);
  if (t.name === 'i8' || t.name === 'u8' || t.kind === 'bool') return mod.i32.store8(offset, 0, ptr, value);
  if (t.name === 'i16' || t.name === 'u16') return mod.i32.store16(offset, 0, ptr, value);
  if (t.wasmType === 'i64') return mod.i64.store(offset, 0, ptr, value);
  if (t.wasmType === 'f32') return mod.f32.store(offset, 0, ptr, value);
  if (t.wasmType === 'f64') return mod.f64.store(offset, 0, ptr, value);
  return mod.i32.store(offset, 0, ptr, value);
}

/**
 * Generate a binary operation expression.
 * @param {any} mod  binaryen Module
 * @param {string} op  JS operator string
 * @param {TypeInfo} typeInfo  type of the operands
 * @param {number} left  ExpressionRef
 * @param {number} right  ExpressionRef
 * @returns {number} ExpressionRef
 */
export function genBinOp(mod, op, typeInfo, left, right) {
  if (!typeInfo || !typeInfo.wasmType) {
    throw new CodegenError(`No WAT type for operator '${op}' with type '${typeInfo?.name}'`);
  }
  const wt = typeInfo.wasmType;
  const isFloat = typeInfo.isFloat;
  const s = typeInfo.isSigned ? '_s' : '_u';

  if (op === '**') {
    // Always operate in f64; convert integer operands if needed
    const toF64 = (expr) => (binaryen.getExpressionType(expr) === binaryen.f64 ? expr : mod.f64.convert_s.i32(expr));
    return mod.call('__jswat_math_pow', [toF64(left), toF64(right)], binaryen.f64);
  }

  switch (op) {
    case '+':   return mod[wt].add(left, right);
    case '-':   return mod[wt].sub(left, right);
    case '*':   return mod[wt].mul(left, right);
    case '/':   return isFloat ? mod[wt].div(left, right) : mod[wt][`div${s}`](left, right);
    case '%':
      if (isFloat) throw new CodegenError('% is not supported for float types');
      return mod[wt][`rem${s}`](left, right);
    case '===': return mod[wt].eq(left, right);
    case '!==': return mod[wt].ne(left, right);
    case '<':   return isFloat ? mod[wt].lt(left, right)  : mod[wt][`lt${s}`](left, right);
    case '>':   return isFloat ? mod[wt].gt(left, right)  : mod[wt][`gt${s}`](left, right);
    case '<=':  return isFloat ? mod[wt].le(left, right)  : mod[wt][`le${s}`](left, right);
    case '>=':  return isFloat ? mod[wt].ge(left, right)  : mod[wt][`ge${s}`](left, right);
    default:
      throw new CodegenError(`Unsupported operator '${op}'`);
  }
}

/**
 * Generate a cast/conversion expression between two types.
 * @param {any} mod  binaryen Module
 * @param {number} value  ExpressionRef
 * @param {TypeInfo|undefined} src
 * @param {TypeInfo} dst
 * @returns {number} ExpressionRef
 */
export function genCast(mod, value, src, dst) {
  if (!src || src === dst) return value;
  // str → integer/float: parse string content (must come before same-wasmType short-circuit)
  if (src.name === 'str' && dst.isInteger) {
    const parsed = mod.call('__jswat_parse_i32', [value], binaryen.i32);
    return dst.wasmType === 'i64' ? mod.i64.extend_s(parsed) : parsed;
  }
  if (src.name === 'str' && dst.isFloat) {
    return mod.call('__jswat_parse_f64', [value], binaryen.f64);
  }
  // Same WASM type — may still need narrow-type masking
  if (src.wasmType === dst.wasmType) {
    if (dst.isInteger && dst.bits > 0 && dst.bits < 32) {
      const mask = (1 << dst.bits) - 1;
      return mod.i32.and(value, mod.i32.const(mask));
    }
    return value;
  }
  // Integer → float conversions
  if (src.isInteger && dst.isFloat) {
    const sv = src.wasmType;   // 'i32' or 'i64'
    const dv = dst.wasmType;   // 'f32' or 'f64'
    if (src.isSigned) {
      return mod[dv].convert_s[sv](value);
    } else {
      return mod[dv].convert_u[sv](value);
    }
  }
  // Float → integer truncation
  if (src.isFloat && dst.isInteger) {
    const sv = src.wasmType;   // 'f32' or 'f64'
    const dv = dst.wasmType;   // 'i32' or 'i64'
    if (dst.isSigned) {
      return mod[dv].trunc_s[sv](value);
    } else {
      return mod[dv].trunc_u[sv](value);
    }
  }
  // f32 ↔ f64
  if (src.wasmType === 'f32' && dst.wasmType === 'f64') return mod.f64.promote(value);
  if (src.wasmType === 'f64' && dst.wasmType === 'f32') return mod.f32.demote(value);
  // i32 ↔ i64
  if (src.wasmType === 'i64' && dst.wasmType === 'i32') return mod.i32.wrap(value);
  if (src.wasmType === 'i32' && dst.wasmType === 'i64')
    return src.isSigned ? mod.i64.extend_s(value) : mod.i64.extend_u(value);
  return value;
}

/**
 * Returns true if the type lives on the heap and needs RC management.
 * @param {TypeInfo | undefined} type
 * @returns {boolean}
 */
export function isHeapType(type) {
  return type?.kind === 'class' || type?.kind === 'array';
}

/**
 * Emit masking to wrap sub-32-bit integers if needed.
 * @param {any} mod  binaryen Module
 * @param {number} expr  ExpressionRef
 * @param {TypeInfo|undefined|null} typeInfo
 * @returns {number} ExpressionRef
 */
export function maybeNarrow(mod, expr, typeInfo) {
  if (!typeInfo) return expr;
  if (typeInfo.isInteger && typeInfo.bits > 0 && typeInfo.bits < 32) {
    const mask = (1 << typeInfo.bits) - 1;
    return mod.i32.and(expr, mod.i32.const(mask));
  }
  return expr;
}
