// Node.js — Monte Carlo π (XorShift32)
const SAMPLES = 10_000_000;
function xorshift(s) { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }
function monteCarloPi(n) {
  let inside = 0, state = -1831433054; // 2463534242 as signed
  for (let i = 0; i < n; i++) {
    state = xorshift(state);
    const x = (state & 0x7fffffff) / 2147483647;
    state = xorshift(state);
    const y = (state & 0x7fffffff) / 2147483647;
    if (x*x + y*y <= 1) inside++;
  }
  return inside / n * 4;
}
const t = performance.now();
const pi = monteCarloPi(SAMPLES);
console.log(`Monte Carlo π (${SAMPLES} samples): ${pi} (${(performance.now()-t).toFixed(1)}ms)`);
