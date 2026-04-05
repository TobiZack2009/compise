// Node.js — Quicksort 100K LCG integers
const N = 100_000;
function partition(arr, lo, hi) {
  const pivot = arr[hi]; let i = lo;
  for (let j = lo; j < hi; j++) {
    if (arr[j] <= pivot) { [arr[i], arr[j]] = [arr[j], arr[i]]; i++; }
  }
  [arr[i], arr[hi]] = [arr[hi], arr[i]]; return i;
}
function quicksort(arr, n) {
  const stack = [[0, n-1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (lo >= hi) continue;
    const p = partition(arr, lo, hi);
    if (p-1 > lo) stack.push([lo, p-1]);
    if (p+1 < hi) stack.push([p+1, hi]);
  }
}
const arr = new Int32Array(N);
let rng = 12345;
for (let i = 0; i < N; i++) { rng = (Math.imul(1664525, rng) + 1013904223) & 0x7fffffff; arr[i] = rng; }
const t = performance.now();
quicksort(arr, N);
const inv = Array.from({length:N-1}, (_,i) => arr[i] > arr[i+1] ? 1 : 0).reduce((a,b)=>a+b,0);
console.log(`Quicksort ${N} ints: ${(performance.now()-t).toFixed(1)}ms, inversions=${inv} (expect 0)`);
