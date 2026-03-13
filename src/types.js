/**
 * @fileoverview Type hierarchy, WASM mappings, and promotion logic for js.wat.
 * All type objects are plain frozen records — never classes.
 */

/**
 * Full type info record.
 * @typedef {{ kind: string, name: string, nullable: boolean, abstract: boolean,
 *             wasmType: string, isInteger: boolean, isFloat: boolean,
 *             isSigned: boolean, bits: number }} TypeInfo
 */

/** @param {object} obj @returns {TypeInfo} */
function t(obj) { return Object.freeze(obj); }

/**
 * All js.wat types, keyed by name.
 * @type {Readonly<Record<string, TypeInfo>>}
 */
const TYPE_REGISTRY = {
  // Bottom type for fixpoint inference — should never reach codegen.
  unknown: t({ kind: 'unknown', name: 'unknown', nullable: false, abstract: false, wasmType: '', isInteger: false, isFloat: false, isSigned: false, bits: 0 }),

  // Abstract numeric supertypes — constraint use only, never instantiated
  Number:  t({ kind: 'abstract', name: 'Number',  nullable: false, abstract: true,  wasmType: '',    isInteger: false, isFloat: false, isSigned: false, bits: 0  }),
  Integer: t({ kind: 'abstract', name: 'Integer', nullable: false, abstract: true,  wasmType: '',    isInteger: true,  isFloat: false, isSigned: false, bits: 0  }),
  Float:   t({ kind: 'abstract', name: 'Float',   nullable: false, abstract: true,  wasmType: '',    isInteger: false, isFloat: true,  isSigned: false, bits: 0  }),

  // Concrete integer types (WASM32: isize/usize map to i32)
  i8:    t({ kind: 'integer', name: 'i8',    nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: true,  bits: 8  }),
  u8:    t({ kind: 'integer', name: 'u8',    nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: false, bits: 8  }),
  i16:   t({ kind: 'integer', name: 'i16',   nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: true,  bits: 16 }),
  u16:   t({ kind: 'integer', name: 'u16',   nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: false, bits: 16 }),
  i32:   t({ kind: 'integer', name: 'i32',   nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: true,  bits: 32 }),
  u32:   t({ kind: 'integer', name: 'u32',   nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: false, bits: 32 }),
  i64:   t({ kind: 'integer', name: 'i64',   nullable: false, abstract: false, wasmType: 'i64', isInteger: true, isFloat: false, isSigned: true,  bits: 64 }),
  u64:   t({ kind: 'integer', name: 'u64',   nullable: false, abstract: false, wasmType: 'i64', isInteger: true, isFloat: false, isSigned: false, bits: 64 }),
  isize: t({ kind: 'integer', name: 'isize', nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: true,  bits: 32 }),
  usize: t({ kind: 'integer', name: 'usize', nullable: false, abstract: false, wasmType: 'i32', isInteger: true, isFloat: false, isSigned: false, bits: 32 }),

  // Concrete float types
  f32: t({ kind: 'float', name: 'f32', nullable: false, abstract: false, wasmType: 'f32', isInteger: false, isFloat: true, isSigned: true, bits: 32 }),
  f64: t({ kind: 'float', name: 'f64', nullable: false, abstract: false, wasmType: 'f64', isInteger: false, isFloat: true, isSigned: true, bits: 64 }),

  // Other primitive types
  bool: t({ kind: 'bool', name: 'bool', nullable: false, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
  str:  t({ kind: 'str',  name: 'str',  nullable: false, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
  void: t({ kind: 'void', name: 'void', nullable: false, abstract: false, wasmType: '',    isInteger: false, isFloat: false, isSigned: false, bits: 0  }),

  // std/collections opaque handles
  Map:   t({ kind: 'collection', name: 'Map',   nullable: true, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
  Set:   t({ kind: 'collection', name: 'Set',   nullable: true, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
  Queue: t({ kind: 'collection', name: 'Queue', nullable: true, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
  Stack: t({ kind: 'collection', name: 'Stack', nullable: true, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
  Deque: t({ kind: 'collection', name: 'Deque', nullable: true, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),

  // Array handles (dynamic buffer of i32 values)
  array: t({ kind: 'array', name: 'array', nullable: true, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),

  // Function reference (table index)
  funcref: t({ kind: 'funcref', name: 'funcref', nullable: false, abstract: false, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),

  // Iterator handle (tagged pointer)
  iter: t({ kind: 'iter', name: 'iter', nullable: true, abstract: true, wasmType: 'i32', isInteger: false, isFloat: false, isSigned: false, bits: 32 }),
};

export const TYPES = TYPE_REGISTRY;

/**
 * Promotion order from lowest to highest precision.
 * Float always beats integer (boundary crossing is a type error without explicit cast).
 * @type {string[]}
 */
export const PROMOTION_ORDER = [
  'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'isize', 'usize', 'i64', 'u64', 'f32', 'f64',
];

/**
 * Set of type names usable as cast-call identifiers (e.g. `u8(x)`, `f64(x)`).
 * @type {Set<string>}
 */
export const CAST_TYPES = new Set([
  'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'isize', 'usize', 'f32', 'f64',
]);

/** @returns {TypeInfo} Default type for integer literals. */
export function defaultIntegerType() { return TYPES.isize; }

/** @returns {TypeInfo} Default type for float literals. */
export function defaultFloatType() { return TYPES.f64; }

/**
 * Return the higher-precision type of a and b under the promotion rules.
 * Returns null if the types cross the Integer/Float boundary (explicit cast required),
 * or if either type is abstract, bool, str, or void.
 * @param {TypeInfo} a
 * @param {TypeInfo} b
 * @returns {TypeInfo|null}
 */
export function promoteTypes(a, b) {
  if (!a || !b) return null;
  if (a === b) return a;
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;
  if (a.abstract || b.abstract) return null;
  if (a.kind === 'bool' || b.kind === 'bool') return null;
  if (a.kind === 'str'  || b.kind === 'str')  return null;
  if (a.kind === 'void' || b.kind === 'void') return null;

  const ai = PROMOTION_ORDER.indexOf(a.name);
  const bi = PROMOTION_ORDER.indexOf(b.name);
  if (ai === -1 || bi === -1) return null;

  // Crossing Integer ↔ Float boundary without explicit cast is an error
  if (a.isFloat !== b.isFloat) return null;

  return ai >= bi ? a : b;
}

/**
 * True when a value of type `source` may be assigned to a binding of type `target`.
 * Abstract target types accept any matching concrete subtype.
 * @param {TypeInfo} target
 * @param {TypeInfo} source
 * @returns {boolean}
 */
export function isAssignable(target, source) {
  if (!target || !source) return false;
  if (target === source) return true;
  if (target.abstract) {
    if (target.name === 'Integer') return source.isInteger && !source.abstract;
    if (target.name === 'Float')   return source.isFloat   && !source.abstract;
    if (target.name === 'Number')  return (source.isInteger || source.isFloat) && !source.abstract;
  }
  return false;
}

/**
 * Map a TypeInfo to the WAT value type string ('i32', 'i64', 'f32', 'f64', or '').
 * @param {TypeInfo|null|undefined} typeInfo
 * @returns {string}
 */
export function toWatType(typeInfo) {
  if (!typeInfo) return '';
  return typeInfo.wasmType || '';
}
