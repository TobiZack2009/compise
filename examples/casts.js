// Type cast examples — Phase 1 compatible
// Demonstrates: cast-call syntax for all numeric types

// Narrow integer casts (wrapping)
//@export
function toU8(x = 0)    { return u8(x); }
//@export
function toI8(x = 0)    { return i8(x); }
//@export
function toU16(x = 0)   { return u16(x); }
//@export
function toI16(x = 0)   { return i16(x); }
//@export
function toU32(x = 0)   { return u32(x); }
//@export
function toI32(x = 0)   { return i32(x); }

// Integer-to-float conversions
//@export
function toF32(x = 0)   { return f32(x); }
//@export
function toF64(x = 0)   { return f64(x); }

// Float-to-integer truncation
//@export
function truncI32(x = 0.0) { return i32(x); }
