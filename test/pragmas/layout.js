//# compiler::test
// Class memory-layout assertions — verify field offsets and class sizes without
// running the generated WASM.  Mirrors the layout portion of test/gc.test.js.
//
// Spec: 12-byte header [rc_class:4 | vtable_ptr:4 | class_id:4], fields at offset 12.
// Compact layout (default): sorts fields largest-to-smallest to minimise padding.

// ── Single-field classes ──────────────────────────────────────────────────────

// One isize field: header(12) + i32(4) = 16 bytes.
//# compiler::layout.field {val} eq 12
//# compiler::layout.size eq 16
class SingleI32 { val = 0; }

// One f64 field: header(12) + f64(8) = 20 bytes.
//# compiler::layout.field {x} eq 12
//# compiler::layout.size eq 20
class SingleF64 { x = 0.0; }

// ── Multi-field classes (compact layout) ──────────────────────────────────────

// Two isize fields: header(12) + i32(4) + i32(4) = 20 bytes.
// Compact layout: both fields are the same size, so declaration order wins.
//# compiler::layout.field {a} eq 12
//# compiler::layout.field {b} eq 16
//# compiler::layout.size eq 20
class TwoI32 { a = 0; b = 0; }

// Two f64 fields: header(12) + f64(8) + f64(8) = 28 bytes.
//# compiler::layout.field {x} eq 12
//# compiler::layout.field {y} eq 20
//# compiler::layout.size eq 28
class TwoF64 { x = 0.0; y = 0.0; }

// Mixed: one f64 + one isize — compact sorts f64 first (larger).
// header(12) + f64(8) + i32(4) = 24 bytes.
//# compiler::layout.field {dist} eq 12
//# compiler::layout.field {id} eq 20
//# compiler::layout.size eq 24
class Mixed { id = 0; dist = 0.0; }

// ── Inheritance layout ────────────────────────────────────────────────────────

// Child extends Parent: parent fields are a prefix of child layout.
// Shape:   [ header:12 | color:i32:4 ]         → size = 16
// Circle:  [ header:12 | color:i32:4 | radius:f64:8 ]  → size = 24
// The child's own new field (radius) is appended AFTER the parent's size (16).
class Shape { color = 0; }

//# compiler::layout.field {color} eq 12
//# compiler::layout.field {radius} eq 16
//# compiler::layout.size eq 24
class Circle extends Shape { radius = 0.0; }
