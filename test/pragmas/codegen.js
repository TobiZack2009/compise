//# compiler::test
// Code-generation assertions — WAT structure checks without running the binary.
// These mirror the WAT-structure tests in test/codegen.test.js.
// The mocha execution tests (WASM instantiation, magic bytes, etc.) remain as
// the authoritative runtime fallback.

// ── WASM signatures ───────────────────────────────────────────────────────────
// binaryen uses indexed param names ($0, $1, …) in WAT output.

//# compiler::emit.sig {(param $0 i32) (param $1 i32) (result i32)}
//@export
function addInts(x = 0, y = 0) { return x + y; }

//# compiler::emit.sig {(param $0 f64) (param $1 f64) (result f64)}
//@export
function addFloats(a = 0.0, b = 0.0) { return a + b; }

//# compiler::emit.sig {(param $0 i32) (result i32)}
//@export
function identity(n = 0) { return n; }

// ── WAT instruction patterns ──────────────────────────────────────────────────

//# compiler::emit.wat {i32.add}
//@export
function sumTwo(a = 0, b = 0) { return a + b; }

//# compiler::emit.wat {f64.mul}
//@export
function mulFloats(a = 0.0, b = 0.0) { return a * b; }

//# compiler::emit.wat {i32.gt_s}
//@export
function isPositive(n = 0) { return n > 0 ? 1 : 0; }

// ── Global WAT structure ──────────────────────────────────────────────────────

//# compiler::emit.wat {(module}
//@export
function moduleMarker() { return 0; }

//# compiler::emit.wat {(export "memory"}
//@export
function memoryExport() { return 0; }
