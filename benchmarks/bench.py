import time

def sieve(n):
    is_prime = bytearray([1]) * (n + 1)
    is_prime[0] = 0
    is_prime[1] = 0
    i = 2
    while i * i <= n:
        if is_prime[i]:
            j = i * i
            while j <= n:
                is_prime[j] = 0
                j += i
        i += 1
    return sum(is_prime)

def fib_count():
    U64_MAX = (1 << 64) - 1
    a, b = 0, 1
    count = 0
    while True:
        nxt = a + b
        if nxt > U64_MAX:
            break
        a, b = b, nxt
        count += 1
        if b == U64_MAX:
            break
    return count

N = 10_000_000

t0 = time.perf_counter()
count = sieve(N)
elapsed_sieve = (time.perf_counter() - t0) * 1000
print(f"Primes up to {N}: {count} ({elapsed_sieve:.1f} ms)")

t1 = time.perf_counter()
fib_n = fib_count()
elapsed_fib = (time.perf_counter() - t1) * 1000
print(f"Fibonacci numbers under u64: {fib_n} ({elapsed_fib:.3f} ms)")
