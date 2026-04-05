// Node.js benchmark

function sieve(n) {
  const isPrime = new Uint8Array(n + 1).fill(1);
  isPrime[0] = 0;
  isPrime[1] = 0;
  for (let i = 2; i * i <= n; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= n; j += i) {
        isPrime[j] = 0;
      }
    }
  }
  let count = 0;
  for (let i = 2; i <= n; i++) {
    if (isPrime[i]) count++;
  }
  return count;
}

function fibCount() {
  const U64_MAX = 18446744073709551615n;
  let a = 0n, b = 1n;
  let count = 0;
  while (true) {
    const next = a + b;
    if (next > U64_MAX) break;
    a = b;
    b = next;
    count++;
    if (b === U64_MAX) break;
  }
  return count;
}

const N = 10_000_000;

const t0 = performance.now();
const count = sieve(N);
const elapsedSieve = (performance.now() - t0).toFixed(1);
console.log(`Primes up to ${N}: ${count} (${elapsedSieve} ms)`);

const t1 = performance.now();
const fibN = fibCount();
const elapsedFib = (performance.now() - t1).toFixed(3);
console.log(`Fibonacci numbers under u64: ${fibN} (${elapsedFib} ms)`);
