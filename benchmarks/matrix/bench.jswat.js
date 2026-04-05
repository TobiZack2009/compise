import { console } from "std/io";
import { Clock } from "std/clock";

const N = 128;

function matmul(n = 0) {
  const sz = n * n;
  const A = new List(i32, sz);
  const B = new List(i32, sz);
  const C = new List(i32, sz);

  let i = 0;
  while (i < n) {
    let j = 0;
    while (j < n) {
      A[i * n + j] = i + j;
      B[i * n + j] = (i * j) % n;
      j = j + 1;
    }
    i = i + 1;
  }

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
console.log(`Matrix multiply ${N}x${N}: checksum=${result} (${elapsed}ms)`);
