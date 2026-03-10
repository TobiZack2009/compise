// Type cast examples — Phase 1 compatible
// Demonstrates: cast-call syntax for all numeric types

// Narrow integer casts (wrapping)
function toU8(x = 0)    { return u8(x); }
function toI8(x = 0)    { return i8(x); }
function toU16(x = 0)   { return u16(x); }
function toI16(x = 0)   { return i16(x); }
function toU32(x = 0)   { return u32(x); }
function toI32(x = 0)   { return i32(x); }

// Integer-to-float conversions
function toF32(x = 0)   { return f32(x); }
function toF64(x = 0)   { return f64(x); }

// Float-to-integer truncation
function truncI32(x = 0.0) { return i32(x); }
