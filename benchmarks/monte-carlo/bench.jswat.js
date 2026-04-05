import { console } from "std/io";
import { Clock } from "std/clock";

const SAMPLES = 10000000;

function xorshift(state = 0) {
  let s = state;
  s = s ^ (s << 13);
  s = s ^ (s >> 17);
  s = s ^ (s << 5);
  return s;
}

function monteCarloPi(n = 0) {
  let inside = 0;
  let state = 2463534242;
  let i = 0;
  while (i < n) {
    state = xorshift(state);
    const x = f64(state & 0x7fffffff) / 2147483647.0;
    state = xorshift(state);
    const y = f64(state & 0x7fffffff) / 2147483647.0;
    if (x * x + y * y <= 1.0) { inside = inside + 1; }
    i = i + 1;
  }
  return f64(inside) / f64(n) * 4.0;
}

const t0 = Clock.now();
const pi = monteCarloPi(SAMPLES);
const elapsed = Clock.now() - t0;
console.log(`Monte Carlo pi (${SAMPLES} samples): ${pi} (${elapsed}ms)`);
