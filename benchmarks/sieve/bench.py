import time
def sieve(n):
    is_prime = bytearray([1]) * (n + 1)
    is_prime[0] = 0; is_prime[1] = 0
    i = 2
    while i * i <= n:
        if is_prime[i]:
            j = i * i
            while j <= n: is_prime[j] = 0; j += i
        i += 1
    return sum(is_prime)
N = 10_000_000
t = time.perf_counter()
c = sieve(N)
print(f"Primes up to {N}: {c} ({(time.perf_counter()-t)*1000:.1f}ms)")
