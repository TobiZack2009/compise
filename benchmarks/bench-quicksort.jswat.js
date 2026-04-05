/**
 * Benchmark: Quicksort of 100K random integers.
 *
 * Uses a simple LCG PRNG to fill the array, then sorts in-place.
 */

import { console } from "std/io";
import { Clock } from "std/clock";

const N = 100000;
const LCG_A = 1664525;
const LCG_C = 1013904223;

function partition(arr = [0], lo = 0, hi = 0) {
  const pivot = arr[hi];
  let i = lo - 1;
  let j = lo;
  while (j < hi) {
    if (arr[j] <= pivot) {
      i = i + 1;
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    j = j + 1;
  }
  const tmp2 = arr[i + 1];
  arr[i + 1] = arr[hi];
  arr[hi] = tmp2;
  return i + 1;
}

// Iterative quicksort using an explicit stack (avoids WASM call stack overflow).
function quicksort(arr = [0], n = 0) {
  const stack = [0];
  let top = -1;

  // Push initial range
  top = top + 1; stack[top] = 0;
  top = top + 1; stack[top] = n - 1;

  while (top >= 0) {
    const hi = stack[top]; top = top - 1;
    const lo = stack[top]; top = top - 1;

    if (lo < hi) {
      const p = partition(arr, lo, hi);
      if (p - 1 > lo) {
        top = top + 1; stack[top] = lo;
        top = top + 1; stack[top] = p - 1;
      }
      if (p + 1 < hi) {
        top = top + 1; stack[top] = p + 1;
        top = top + 1; stack[top] = hi;
      }
    }
  }
}

// Fill array with LCG PRNG values
const arr = [0];
let rng = 12345;
let i = 0;
while (i < N) {
  rng = (LCG_A * rng + LCG_C) & 0x7fffffff;
  arr.push(rng);
  i = i + 1;
}

const t0 = Clock.now();
quicksort(arr, N);
const elapsed = Clock.now() - t0;

// Verify sorted: count adjacent inversions
let inversions = 0;
i = 1;
while (i < N) {
  if (arr[i] < arr[i - 1]) { inversions = inversions + 1; }
  i = i + 1;
}
console.log(`Quicksort ${N} ints: ${elapsed}ms, inversions=${inversions} (expect 0)`);
