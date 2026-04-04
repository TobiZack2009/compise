/**
 * @fileoverview buildClassLayouts.
 *
 * Builds compact field-offset maps for all classes.
 *
 * Layout rules (spec §Memory Layout):
 *  - 12-byte header: [rc_class:4 | vtable_ptr:4 | class_id:4]
 *  - Fields start at offset 12.
 *  - Default (compact): sorted largest-to-smallest to minimise padding.
 *  - @ordered: fields in declaration order (no sorting).
 *  - Inheritance: parent fields always form a PREFIX of child layout at their
 *    original offsets.  Only the child's OWN new fields are sorted/appended.
 *    This lets C or JS hosts safely cast a child pointer to the parent type.
 */

import { typeSize, resolveFieldType } from './types.js';

/**
 * @typedef {import('../types.js').TypeInfo} TypeInfo
 */

/**
 * @param {Map<string, import('../typecheck.js').ClassInfo>} classes
 * @returns {Map<string, { classId: number, size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>}
 */
export function buildClassLayouts(classes) {
  const layouts = new Map();
  let nextClassId = 1;

  // Process classes in topological order — parents before children — so each
  // child can look up its parent's already-computed layout.
  const processed = new Set();

  function processClass(name) {
    if (processed.has(name)) return;
    const classInfo = classes.get(name);
    if (!classInfo) return;
    // Recurse into parent first.
    if (classInfo.superClassName) processClass(classInfo.superClassName);
    processed.add(name);

    const classId   = nextClassId++;
    const fields    = new Map();

    // ── Inherit parent layout (prefix) ───────────────────────────────────────
    // Copy parent field entries at their original offsets.  The parent's size
    // becomes the starting offset for the child's own new fields.
    const parentLayout = classInfo.superClassName
      ? layouts.get(classInfo.superClassName) : null;
    let offset = parentLayout ? parentLayout.size : 12;

    if (parentLayout) {
      for (const [fname, finfo] of parentLayout.fields) {
        fields.set(fname, finfo);   // same {offset, type} object
      }
    }

    // ── Child's own fields ────────────────────────────────────────────────────
    // Exclude any name already present from the parent.
    const ownEntries = Array.from(classInfo.fields.entries())
      .filter(([name]) => !fields.has(name))
      .map(([name, typeInfo]) => {
        const resolved = resolveFieldType(typeInfo);
        return { name, resolved, size: typeSize(resolved) };
      });

    // Sort own fields largest-to-smallest for compact packing (unless @ordered).
    if (!classInfo.ordered) {
      ownEntries.sort((a, b) => b.size - a.size);
    }

    for (const { name, resolved, size } of ownEntries) {
      fields.set(name, { offset, type: resolved });
      offset += size;
    }

    layouts.set(name, { classId, size: offset, fields });
  }

  for (const name of classes.keys()) processClass(name);

  return layouts;
}
