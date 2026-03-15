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
  let nextClassId = 1;
  for (const classInfo of classes.values()) {
    const classId = nextClassId++;
    let offset = 12; // 12-byte header: rc_class(4) + vtable_ptr(4) + class_id(4)
    const fields = new Map();
    for (const [name, typeInfo] of classInfo.fields.entries()) {
      const resolved = resolveFieldType(typeInfo);
      const size = typeSize(resolved);
      fields.set(name, { offset, type: resolved });
      offset += size;
    }
    layouts.set(classInfo.name, { classId, size: offset, fields });
  }
  return layouts;
}
