// Node.js — Integer matrix multiply N×N
const N = 128;
function matmul(n) {
  const a = new Int32Array(n*n), b = new Int32Array(n*n), c = new Int32Array(n*n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    a[i*n+j] = i+j; b[i*n+j] = (i*j)%n;
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += a[i*n+k] * b[k*n+j];
    c[i*n+j] = s;
  }
  let chk = 0; for (let x = 0; x < n; x++) chk += c[x];
  return chk;
}
const t = performance.now();
const r = matmul(N);
console.log(`Matrix multiply ${N}x${N}: checksum=${r} (${(performance.now()-t).toFixed(1)}ms)`);
