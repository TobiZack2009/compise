// Node.js — f32 dot product (Float32Array, N=1M)
const N = 1_000_000;
function dotProduct(n) {
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = (i % 100 + 1) / 100;
    a[i] = v; b[i] = 1 - v;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return Math.fround(sum);
}
const t = performance.now();
const r = dotProduct(N);
console.log(`f32 dot product (N=${N}): ${r} (${(performance.now()-t).toFixed(1)}ms)`);
