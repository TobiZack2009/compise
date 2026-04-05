// Node.js — Sieve of Eratosthenes
const N = 10_000_000;
function countPrimes(n) {
  const sieve = new Uint8Array(n + 1).fill(1);
  sieve[0] = 0; sieve[1] = 0;
  for (let i = 2; i * i <= n; i++) {
    if (sieve[i]) for (let j = i * i; j <= n; j += i) sieve[j] = 0;
  }
  let c = 0;
  for (let i = 2; i <= n; i++) if (sieve[i]) c++;
  return c;
}
const t = performance.now();
const c = countPrimes(N);
console.log(`Primes up to ${N}: ${c} (${(performance.now()-t).toFixed(1)}ms)`);
