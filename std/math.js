import { f64_sqrt, f64_floor, f64_ceil, f64_abs, f64_trunc, f64_min, f64_max, f64_copysign,
         f32_sqrt, f32_floor, f32_ceil, f32_abs, f32_trunc, f32_min, f32_max,
         i32_clz, i32_popcnt, i64_reinterpret_f64, f64_reinterpret_i64,
         i32_reinterpret_f32, f32_reinterpret_i32 } from "std/wasm";

export class Math {
  // ── Constants ─────────────────────────────────────────────────────────────
  static PI      = 3.141592653589793;
  static E       = 2.718281828459045;
  static LN2     = 0.6931471805599453;
  static LN10    = 2.302585092994046;
  static LOG2E   = 1.4426950408889634;
  static LOG10E  = 0.4342944819032518;
  static SQRT2   = 1.4142135623730951;
  static SQRT1_2 = 0.7071067811865476;

  // ── Native f64 ops ────────────────────────────────────────────────────────
  static sqrt(x = 0.0)         { return f64_sqrt(x); }
  static floor(x = 0.0)        { return f64_floor(x); }
  static ceil(x = 0.0)         { return f64_ceil(x); }
  static abs(x = 0.0)          { return f64_abs(x); }
  static trunc(x = 0.0)        { return f64_trunc(x); }
  static min(a = 0.0, b = 0.0) { return f64_min(a, b); }
  static max(a = 0.0, b = 0.0) { return f64_max(a, b); }

  // ── Derived float ops ─────────────────────────────────────────────────────
  static round(x = 0.0)        { return f64_floor(x + 0.5); }
  static sign(x = 0.0)         { return x > 0.0 ? 1.0 : (x < 0.0 ? -1.0 : 0.0); }
  static clamp(x = 0.0, lo = 0.0, hi = 0.0) { return f64_min(f64_max(x, lo), hi); }
  static fround(x = 0.0)       { return f64(f32(x)); }

  // ── Transcendentals ───────────────────────────────────────────────────────
  static exp(x = 0.0) {
    // Taylor series: e^x = Σ x^n/n!  (20 terms; sufficient for |x| < 10)
    let result = 1.0;
    let term = 1.0;
    for (let i = 1; i < 21; i = i + 1) {
      term = term * (x / f64(i));
      result = result + term;
    }
    return result;
  }

  static expm1(x = 0.0) { return Math.exp(x) - 1.0; }

  static log(x = 0.0) {
    // log(x) = 2 * atanh((x-1)/(x+1)),  atanh(u) = u + u^3/3 + u^5/5 + …
    const u = (x - 1.0) / (x + 1.0);
    const u2 = u * u;
    let term = u;
    let result = 0.0;
    for (let i = 0; i < 20; i = i + 1) {
      result = result + term / f64(2 * i + 1);
      term = term * u2;
    }
    return 2.0 * result;
  }

  static log1p(x = 0.0) { return Math.log(1.0 + x); }
  static log2(x = 0.0)  { return Math.log(x) / 0.6931471805599453; }   // / LN2
  static log10(x = 0.0) { return Math.log(x) / 2.302585092994046; }    // / LN10

  // ── pow depends on exp + log ──────────────────────────────────────────────
  static pow(a = 0.0, b = 0.0) {
    return Math.exp(b * Math.log(a));
  }

  static cbrt(x = 0.0) {
    if (x < 0.0) { return -Math.pow(-x, 0.3333333333333333); }
    return Math.pow(x, 0.3333333333333333);
  }

  static hypot(x = 0.0, y = 0.0) { return f64_sqrt(x * x + y * y); }

  // ── Trigonometry ──────────────────────────────────────────────────────────
  static sin(x = 0.0) {
    // Arg-reduce to [-π, π], then Taylor series
    const TWO_PI = 6.283185307179586;
    x = x - TWO_PI * f64_floor(x / TWO_PI + 0.5);
    const x2 = x * x;
    let term = x;
    let result = x;
    for (let i = 1; i < 12; i = i + 1) {
      const n = f64(2 * i);
      term = term * (x2 / (n * (n + 1.0))) * -1.0;
      result = result + term;
    }
    return result;
  }

  static cos(x = 0.0) {
    return Math.sin(x + 1.5707963267948966); // x + π/2
  }

  static tan(x = 0.0) { return Math.sin(x) / Math.cos(x); }

  // atan must come before asin/acos
  static atan(x = 0.0) {
    // Range reduction without self-recursion: track flags as floats
    let neg = x < 0.0 ? 1.0 : 0.0;
    if (x < 0.0) { x = -x; }
    let inv = x > 1.0 ? 1.0 : 0.0;
    if (x > 1.0) { x = 1.0 / x; }
    // Taylor series for |x| <= 1: x - x^3/3 + x^5/5 - ...
    const x2 = x * x;
    let term = x;
    let result = x;
    for (let i = 1; i < 20; i = i + 1) {
      term = term * x2 * -1.0;
      result = result + term / f64(2 * i + 1);
    }
    if (inv > 0.0) { result = 1.5707963267948966 - result; }
    if (neg > 0.0) { result = -result; }
    return result;
  }

  static asin(x = 0.0) {
    return Math.atan(x / f64_sqrt(1.0 - x * x));
  }

  static acos(x = 0.0) {
    return 1.5707963267948966 - Math.asin(x); // π/2 - asin(x)
  }

  static atan2(y = 0.0, x = 0.0) {
    if (x > 0.0) { return Math.atan(y / x); }
    if (x < 0.0) {
      if (y >= 0.0) { return Math.atan(y / x) + 3.141592653589793; }
      return Math.atan(y / x) - 3.141592653589793;
    }
    // x == 0
    if (y > 0.0) { return 1.5707963267948966; }
    if (y < 0.0) { return -1.5707963267948966; }
    return 0.0;
  }

  // ── Hyperbolic ────────────────────────────────────────────────────────────
  static sinh(x = 0.0) { return (Math.exp(x) - Math.exp(-x)) * 0.5; }
  static cosh(x = 0.0) { return (Math.exp(x) + Math.exp(-x)) * 0.5; }
  static tanh(x = 0.0) {
    const e2x = Math.exp(2.0 * x);
    return (e2x - 1.0) / (e2x + 1.0);
  }

  static asinh(x = 0.0) { return Math.log(x + f64_sqrt(x * x + 1.0)); }
  static acosh(x = 0.0) { return Math.log(x + f64_sqrt(x * x - 1.0)); }
  static atanh(x = 0.0) { return Math.log((1.0 + x) / (1.0 - x)) * 0.5; }

  // ── Angle conversion ──────────────────────────────────────────────────────
  static degToRad(d = 0.0) { return d * 0.017453292519943295; }  // d * π/180
  static radToDeg(r = 0.0) { return r * 57.29577951308232; }      // r * 180/π

  // ── Interpolation / mapping ───────────────────────────────────────────────
  static lerp(a = 0.0, b = 0.0, t = 0.0) { return a + t * (b - a); }
  static smoothstep(lo = 0.0, hi = 0.0, x = 0.0) {
    const t = Math.clamp((x - lo) / (hi - lo), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }
  static map(x = 0.0, a = 0.0, b = 0.0, c = 0.0, d = 0.0) {
    return c + (x - a) / (b - a) * (d - c);
  }

  // ── Integer ops ───────────────────────────────────────────────────────────
  static clz32(x = i32(0))         { return i32_clz(x); }
  static popcnt(x = i32(0))        { return i32_popcnt(x); }
  static imul(a = i32(0), b = i32(0)) { return a * b; }

  // ── Reinterpret ───────────────────────────────────────────────────────────
  static reinterpretAsI64(x = 0.0) { return i64_reinterpret_f64(x); }
  static reinterpretAsF64(x = i64(0)) { return f64_reinterpret_i64(x); }
  static reinterpretAsI32(x = f32(0)) { return i32_reinterpret_f32(x); }
  static reinterpretAsF32(x = i32(0)) { return f32_reinterpret_i32(x); }
}
