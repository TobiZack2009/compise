// Node.js — Fibonacci numbers under u64
const U64_MAX = 18446744073709551615n;
function fibCount() {
  let a = 0n, b = 1n, count = 0;
  while (true) {
    const next = a + b;
    if (next > U64_MAX) break;
    a = b; b = next; count++;
    if (b === U64_MAX) break;
  }
  return count;
}
const t = performance.now();
const n = fibCount();
console.log(`Fibonacci numbers under u64: ${n} (${(performance.now()-t).toFixed(3)}ms)`);
