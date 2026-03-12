// std/wasm — WASM instruction intrinsics (compiler replaces calls with opcodes).

export function i32_clz(x = i32(0)) { return i32(0); }
export function i32_ctz(x = i32(0)) { return i32(0); }
export function i32_popcnt(x = i32(0)) { return i32(0); }
export function i32_rotl(x = i32(0), n = i32(0)) { return i32(0); }
export function i32_rotr(x = i32(0), n = i32(0)) { return i32(0); }

export function i64_clz(x = i64(0)) { return i64(0); }
export function i64_ctz(x = i64(0)) { return i64(0); }
export function i64_popcnt(x = i64(0)) { return i64(0); }
export function i64_rotl(x = i64(0), n = i64(0)) { return i64(0); }
export function i64_rotr(x = i64(0), n = i64(0)) { return i64(0); }

export function f32_sqrt(x = f32(0.0)) { return f32(0.0); }
export function f32_floor(x = f32(0.0)) { return f32(0.0); }
export function f32_ceil(x = f32(0.0)) { return f32(0.0); }
export function f32_trunc(x = f32(0.0)) { return f32(0.0); }
export function f32_nearest(x = f32(0.0)) { return f32(0.0); }
export function f32_abs(x = f32(0.0)) { return f32(0.0); }
export function f32_min(a = f32(0.0), b = f32(0.0)) { return f32(0.0); }
export function f32_max(a = f32(0.0), b = f32(0.0)) { return f32(0.0); }
export function f32_copysign(x = f32(0.0), y = f32(0.0)) { return f32(0.0); }

export function f64_sqrt(x = 0.0) { return 0.0; }
export function f64_floor(x = 0.0) { return 0.0; }
export function f64_ceil(x = 0.0) { return 0.0; }
export function f64_trunc(x = 0.0) { return 0.0; }
export function f64_nearest(x = 0.0) { return 0.0; }
export function f64_abs(x = 0.0) { return 0.0; }
export function f64_min(a = 0.0, b = 0.0) { return 0.0; }
export function f64_max(a = 0.0, b = 0.0) { return 0.0; }
export function f64_copysign(x = 0.0, y = 0.0) { return 0.0; }

export function i32_reinterpret_f32(x = f32(0.0)) { return i32(0); }
export function f32_reinterpret_i32(x = i32(0)) { return f32(0.0); }
export function i64_reinterpret_f64(x = 0.0) { return i64(0); }
export function f64_reinterpret_i64(x = i64(0)) { return 0.0; }

export function i32_load(addr = usize(0), offset = usize(0)) { return i32(0); }
export function i32_store(addr = usize(0), offset = usize(0), v = i32(0)) { }
export function i32_load8_s(addr = usize(0), offset = usize(0)) { return i32(0); }
export function i32_load8_u(addr = usize(0), offset = usize(0)) { return i32(0); }
export function i32_store8(addr = usize(0), offset = usize(0), v = i32(0)) { }
export function i32_load16_s(addr = usize(0), offset = usize(0)) { return i32(0); }
export function i32_load16_u(addr = usize(0), offset = usize(0)) { return i32(0); }
export function i32_store16(addr = usize(0), offset = usize(0), v = i32(0)) { }
export function i64_load(addr = usize(0), offset = usize(0)) { return i64(0); }
export function i64_store(addr = usize(0), offset = usize(0), v = i64(0)) { }
export function f32_load(addr = usize(0), offset = usize(0)) { return f32(0.0); }
export function f32_store(addr = usize(0), offset = usize(0), v = f32(0.0)) { }
export function f64_load(addr = usize(0), offset = usize(0)) { return 0.0; }
export function f64_store(addr = usize(0), offset = usize(0), v = 0.0) { }
export function memory_size() { return usize(0); }
export function memory_grow(n = usize(0)) { return usize(0); }
export function memory_copy(dst = usize(0), src = usize(0), n = usize(0)) { }
export function memory_fill(dst = usize(0), val = i32(0), n = usize(0)) { }
