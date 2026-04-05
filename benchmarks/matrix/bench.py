import time
N = 128
def matmul(n):
    a = [i+j for i in range(n) for j in range(n)]
    b = [(i*j)%n for i in range(n) for j in range(n)]
    c = [0] * (n*n)
    for i in range(n):
        for j in range(n):
            s = 0
            for k in range(n): s += a[i*n+k] * b[k*n+j]
            c[i*n+j] = s
    return sum(c[:n])
t = time.perf_counter()
r = matmul(N)
print(f"Matrix multiply {N}x{N}: checksum={r} ({(time.perf_counter()-t)*1000:.1f}ms)")
