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
 * @returns {Map<string, { classId: number, maxClassId: number, size: number, fields: Map<string, { offset: number, type: TypeInfo }> }>}
 */
export function buildClassLayouts(classes) {
  const layouts = new Map();
  let nextClassId = 1;

  // ── Phase 1: DFS class ID assignment ───────────────────────────────────────
  // Build parent→children map so we can do DFS from roots.
  // DFS pre-order guarantees: all descendants of a class get *contiguous* IDs
  // immediately after the class's own ID. This makes `instanceof` a range check:
  //   class_id >= parent.classId && class_id <= parent.maxClassId
  const children = new Map();   // parent name → [child names]
  for (const [name, info] of classes) {
    const p = info.superClassName;
    if (p && classes.has(p)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(name);
    }
  }

  const idMap = new Map();  // name → assigned classId
  function assignId(name) {
    if (idMap.has(name)) return;
    idMap.set(name, nextClassId++);
    for (const child of (children.get(name) ?? [])) assignId(child);
  }
  // Assign from roots first (classes whose parent is absent from `classes`)
  for (const [name, info] of classes) {
    if (!info.superClassName || !classes.has(info.superClassName)) assignId(name);
  }
  // Catch any remainder (e.g. cycle — shouldn't happen)
  for (const name of classes.keys()) assignId(name);

  // ── Phase 2: Layout construction in topological order ──────────────────────
  // Process parents before children so each child can inherit the parent layout.
  const processed = new Set();

  function processClass(name) {
    if (processed.has(name)) return;
    const classInfo = classes.get(name);
    if (!classInfo) return;
    // Recurse into parent first.
    if (classInfo.superClassName) processClass(classInfo.superClassName);
    processed.add(name);

    const classId   = idMap.get(name) ?? nextClassId++;
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

    layouts.set(name, { classId, maxClassId: classId, size: offset, fields });
  }

  for (const name of classes.keys()) processClass(name);

  // ── Phase 3: Compute maxClassId (max ID in each class's subtree) ───────────
  // Walk bottom-up: each parent's maxClassId = max(own classId, children's maxClassId)
  // Process in reverse insertion order so children (higher IDs) are visited first.
  const layoutNames = [...layouts.keys()].reverse();
  for (const name of layoutNames) {
    const layout = layouts.get(name);
    if (!layout) continue;
    const classInfo = classes.get(name);
    const parentName = classInfo?.superClassName;
    if (parentName) {
      const parentLayout = layouts.get(parentName);
      if (parentLayout && layout.maxClassId > parentLayout.maxClassId) {
        parentLayout.maxClassId = layout.maxClassId;
      }
    }
  }

  return layouts;
}
