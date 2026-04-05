/**
 * Benchmark: Monte Carlo π estimation using 10M samples.
 *
 * Uses a simple XorShift32 PRNG. Tests f64 arithmetic throughput.
 * Estimates π as 4 × (points inside unit circle / total points).
 */

import { console } from "std/io";
import { Clock } from "std/clock";

const SAMPLES = 10000000;

// XorShift32 PRNG — very fast, good distribution for this purpose.
function xorshift(state = 0) {
  let s = state;
  s = s ^ (s << 13);
  s = s ^ (s >> 17);
  s = s ^ (s << 5);
  return s;
}

// Convert unsigned i32 to f64 in [0,1)
function toUnit(x = 0) {
  return f64(x & 0x7fffffff) / 2147483647.0;
}

function monteCarloPi(n = 0) {
  let inside = 0;
  let state = 2463534242;  // non-zero seed
  let i = 0;
  while (i < n) {
    state = xorshift(state);
    const x = toUnit(state);
    state = xorshift(state);
    const y = toUnit(state);
    if (x * x + y * y <= 1.0) {
      inside = inside + 1;
    }
    i = i + 1;
  }
  return f64(inside) / f64(n) * 4.0;
}

const t0 = Clock.now();
const pi = monteCarloPi(SAMPLES);
const elapsed = Clock.now() - t0;
console.log(`Monte Carlo π (${SAMPLES} samples): ${pi} (${elapsed}ms)`);
