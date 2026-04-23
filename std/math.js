import { f64_sqrt, f64_floor, f64_ceil, f64_abs, f64_trunc, f64_min, f64_max } from "std/wasm";

export class Math {
  static sqrt(x = 0.0)         { return f64_sqrt(x); }
  static floor(x = 0.0)        { return f64_floor(x); }
  static ceil(x = 0.0)         { return f64_ceil(x); }
  static abs(x = 0.0)          { return f64_abs(x); }
  static trunc(x = 0.0)        { return f64_trunc(x); }
  static min(a = 0.0, b = 0.0) { return f64_min(a, b); }
  static max(a = 0.0, b = 0.0) { return f64_max(a, b); }

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

  static pow(a = 0.0, b = 0.0) {
    return Math.exp(b * Math.log(a));
  }
}
