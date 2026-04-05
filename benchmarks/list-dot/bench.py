import time, struct
N = 1_000_000
def dot_product(n):
    a = [0.0] * n; b = [0.0] * n
    for i in range(n):
        v = (i % 100 + 1) / 100.0
        # Clamp to f32 precision
        v = struct.unpack('f', struct.pack('f', v))[0]
        a[i] = v; b[i] = struct.unpack('f', struct.pack('f', 1.0 - v))[0]
    return sum(a[i] * b[i] for i in range(n))
t = time.perf_counter()
r = dot_product(N)
print(f"f32 dot product (N={N}): {r:.6f} ({(time.perf_counter()-t)*1000:.1f}ms)")
