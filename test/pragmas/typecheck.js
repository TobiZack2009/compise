//# compiler::test
// Type-inference assertions — static checks that do not require WASM execution.
// Each //# compiler::type.infer {T} directive asserts the inferred type of the
// immediately following top-level VariableDeclaration.
//
// These mirror the literal / cast tests in test/typecheck.test.js.
// The mocha tests remain as the authoritative runtime-accessible fallback.

// ── Numeric literals ──────────────────────────────────────────────────────────

//# compiler::type.infer {isize}
const intLiteral0 = 0;

//# compiler::type.infer {isize}
const intLiteral42 = 42;

//# compiler::type.infer {f64}
const floatLiteral0 = 0.0;

//# compiler::type.infer {f64}
const floatLiteral314 = 3.14;

// ── Bool literals ─────────────────────────────────────────────────────────────

//# compiler::type.infer {bool}
const boolTrue = true;

//# compiler::type.infer {bool}
const boolFalse = false;

// ── String literal ────────────────────────────────────────────────────────────

//# compiler::type.infer {str}
const strEmpty = "";

//# compiler::type.infer {str}
const strHello = "hello";

// ── Cast-call inference ───────────────────────────────────────────────────────

//# compiler::type.infer {u8}
const castU8 = u8(0);

//# compiler::type.infer {i32}
const castI32 = i32(0);

//# compiler::type.infer {f32}
const castF32 = f32(0.0);

//# compiler::type.infer {i64}
const castI64 = i64(0);

//# compiler::type.infer {usize}
const castUsize = usize(0);

//# compiler::type.infer {isize}
const castIsize = isize(0);

//# compiler::type.infer {u32}
const castU32 = u32(0);

//# compiler::type.infer {i16}
const castI16 = i16(0);

//# compiler::type.infer {u16}
const castU16 = u16(0);
