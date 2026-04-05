/**
 * Benchmark: Dense N×N f64 matrix multiply (N=128).
 *
 * Uses dynamic arrays (the existing array type) to store matrices.
 * Each matrix is row-major: A[i*N+j] for element (i,j).
 * Measures pure FLOP throughput.
 */

import { console } from "std/io";
import { Clock } from "std/clock";

const N = 128;

// Allocate a 1D array of N*N f64 elements (stored as bit-pattern in i32 array).
// Note: js.wat arrays store i32; use reinterpret convention for f64 or store as i32 approximate.
// For a clean benchmark, we use i32 arithmetic (integer matrix multiply).

function matmul(n = 0) {
  // A and B are n×n matrices filled with simple values.
  // We do integer multiply for speed (avoids f64 cast complexity).
  const A = [0];
  const B = [0];
  const C = [0];
  let i = 0;
  while (i < n * n) {
    A.push(0);
    B.push(0);
    C.push(0);
    i = i + 1;
  }
  A[0] = 0;
  B[0] = 0;
  C[0] = 0;

  // Fill A[i,j] = i + j, B[i,j] = i * j % n
  i = 0;
  while (i < n) {
    let j = 0;
    while (j < n) {
      A[i * n + j] = i + j;
      B[i * n + j] = (i * j) % n;
      j = j + 1;
    }
    i = i + 1;
  }

  // C = A × B
  i = 0;
  while (i < n) {
    let j = 0;
    while (j < n) {
      let sum = 0;
      let k = 0;
      while (k < n) {
        sum = sum + A[i * n + k] * B[k * n + j];
        k = k + 1;
      }
      C[i * n + j] = sum;
      j = j + 1;
    }
    i = i + 1;
  }

  // Return checksum of first row
  let chk = 0;
  let x = 0;
  while (x < n) {
    chk = chk + C[x];
    x = x + 1;
  }
  return chk;
}

const t0 = Clock.now();
const result = matmul(N);
const elapsed = Clock.now() - t0;
console.log(`Matrix multiply ${N}×${N}: checksum=${result} (${elapsed}ms)`);
