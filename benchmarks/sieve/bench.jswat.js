import { console } from "std/io";
import { Clock } from "std/clock";

const N = 10000000;

function countPrimes(n = 0) {
  const sieve = new List(u8, n + 1);
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

const t0 = Clock.now();
const c = countPrimes(N);
const elapsed = Clock.now() - t0;
console.log(`Primes up to ${N}: ${c} (${elapsed}ms)`);
