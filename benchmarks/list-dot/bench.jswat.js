/**
 * Benchmark: Dot product of two List<f32> of length 1M.
 *
 * Tests List<T> codegen quality: sequential read throughput + f32 FLOP.
 * Requires List<T> to be implemented (spec §395).
 */

import { console } from "std/io";
import { Clock } from "std/clock";

const N = 1000000;

function dotProduct(n = 0) {
  const a = new List(f32, n);
  const b = new List(f32, n);

  // Fill: a[i] = f32(i % 100 + 1) / 100.0, b[i] = 1.0 - a[i]
  let i = 0;
  while (i < n) {
    const v = f32(i % 100 + 1) / f32(100);
    a[i] = v;
    b[i] = f32(1.0) - v;
    i = i + 1;
  }

  // Dot product
  let sum = f32(0.0);
  i = 0;
  while (i < n) {
    sum = sum + a[i] * b[i];
    i = i + 1;
  }
  return sum;
}

const t0 = Clock.now();
const result = dotProduct(N);
const elapsed = Clock.now() - t0;
console.log(`List<f32> dot product (N=${N}): ${result} (${elapsed}ms)`);
