import time, struct
SAMPLES = 10_000_000
def xorshift(s):
    s = struct.unpack('I', struct.pack('i', s))[0]  # treat as unsigned
    s ^= (s << 13) & 0xffffffff
    s ^= (s >> 17) & 0xffffffff
    s ^= (s << 5)  & 0xffffffff
    return struct.unpack('i', struct.pack('I', s))[0]  # back to signed
def monte_carlo_pi(n):
    inside = 0; state = -1831433054  # 2463534242 signed
    for _ in range(n):
        state = xorshift(state)
        x = (state & 0x7fffffff) / 2147483647
        state = xorshift(state)
        y = (state & 0x7fffffff) / 2147483647
        if x*x + y*y <= 1.0: inside += 1
    return inside / n * 4.0
t = time.perf_counter()
pi = monte_carlo_pi(SAMPLES)
print(f"Monte Carlo π ({SAMPLES} samples): {pi} ({(time.perf_counter()-t)*1000:.1f}ms)")
