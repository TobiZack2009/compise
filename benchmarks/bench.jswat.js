import { console } from "std/io";
import { Clock } from "std/clock";

const N = 10000000;

function countPrimes(n = 0) {
  // List<u8>: 1 byte/element, allocated upfront — 10× more cache-friendly than i32 array.
  const sieve = new List(u8, n + 1);
  // WASM memory is zero-initialised; mark all candidates as prime (1).
  let i = 0;
  while (i <= n) { sieve[i] = 1; i = i + 1; }
  sieve[0] = 0;
  sieve[1] = 0;
  i = 2;
  while (i * i <= n) {
    if (sieve[i]) {
      let j = i * i;
      while (j <= n) { sieve[j] = 0; j = j + i; }
    }
    i = i + 1;
  }
  let count = 0;
  i = 2;
  while (i <= n) {
    if (sieve[i]) { count = count + 1; }
    i = i + 1;
  }
  return count;
}

function fibCount() {
  let a = i64(0);
  let b = i64(1);
  let count = 0;
  while (1) {
    const next = a + b;
    if (next < b) { break; }
    a = b;
    b = next;
    count = count + 1;
  }
  return count;
}

const t0 = Clock.now();
const c = countPrimes(N);
const elapsedSieve = Clock.now() - t0;
console.log(`Primes up to ${N}: ${c} (${elapsedSieve}ms)`);

const t1 = Clock.now();
const fibN = fibCount();
const elapsedFib = Clock.now() - t1;
console.log(`Fibonacci numbers under u64: ${fibN} (${elapsedFib}ms)`);
