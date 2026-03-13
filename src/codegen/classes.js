/**
 * @fileoverview buildClassLayouts.
 */

import { typeSize, resolveFieldType } from './types.js';

/**
 * @typedef {import('../types.js').TypeInfo} TypeInfo
 */

/**
 * @param {Map<string, import('../typecheck.js').ClassInfo>} classes
 * @returns {Map<string, { size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>}
 */
export function buildClassLayouts(classes) {
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
