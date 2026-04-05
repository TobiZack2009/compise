import time
def fib_count():
    U64_MAX = (1 << 64) - 1
    a, b, count = 0, 1, 0
    while True:
        nxt = a + b
        if nxt > U64_MAX: break
        a, b = b, nxt; count += 1
        if b == U64_MAX: break
    return count
t = time.perf_counter()
n = fib_count()
print(f"Fibonacci numbers under u64: {n} ({(time.perf_counter()-t)*1000:.3f}ms)")
